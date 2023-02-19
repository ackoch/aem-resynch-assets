import fetch from 'node-fetch'
import HttpsProxyAgent from 'https-proxy-agent'
import base64 from 'base-64'
import yargs from 'yargs';


// Check & set Environment
const version = process.version.replace(/^v([0-9]+).*/, '$1')
if(version < 18){
    console.log('This script requires node v18 or higher')
    process.exit(1)
} 

// Get CLI parameters
const args = getArgs()

const AUTHOR = args.author
const PUBLISH = args.publish
const PROXY = args.proxy
const STARTPATH = args.path
const USER = args.user
const PASSWORD = args.password
const DRYRUN = !args.resynch
const DRY = DRYRUN?'DRYRUN':''
const REPLICATION_DELAY = args.delay
const TICS = args.tics
const DEBUG = args.debug

if (args.allowinsecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

if(DEBUG) TICS = false

// Consts
const ASSET = 'assets/asset'
const FOLDER = 'assets/folder'


// Globals
const AUTH_TOKEN = 'Basic ' + base64.encode(USER + ":" + PASSWORD)
const AUTH_HEADER = new Headers();
AUTH_HEADER.append('Authorization', AUTH_TOKEN);

let PROXYAGENT
if(PROXY){
    PROXYAGENT = new HttpsProxyAgent(PROXY)
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
} else{
    PROXYAGENT = null
}


// Main
main(STARTPATH).then(r => {
    console.log("Done")
})

async function main(startPath){
    try{
        
        // Traverse Author and Publish (see https://experienceleague.adobe.com/docs/experience-manager-65/assets/extending/mac-api-assets.html)
        const authorAssets = await traverse(AUTHOR + '/api/assets' + startPath , 'a')
        const publishAssets = await traverse(PUBLISH + '/api/assets' + startPath , 'p')

        // Combine views from Author and Publish
        const combinedLookup = new Map()

        authorAssets.forEach(asset => {
            let combinedAsset = {...asset}
            combinedAsset.onAuthor = true
            combinedAsset.onPublish = false
            combinedLookup.set(combinedAsset.path, combinedAsset)
        })

        publishAssets.forEach(asset => {
            let combinedAsset = combinedLookup.get(asset.path)
            
            if(!combinedAsset){
                combinedAsset = {...asset}
                combinedLookup.set(combinedAsset.path, combinedAsset)
                combinedAsset.onAuthor = false
            }

            combinedAsset.onPublish = true
        })
    
        
        // Check status on author to verify if an asset should be published or depublished
        for (const asset of combinedLookup.values()){
            debug(`Checking status of ${JSON.stringify(asset)}`)
            tic('d')
            asset.activated = await getReplicationStatus(asset.path)
        }

        console.log('')
        console.table(Array.from(combinedLookup.values()), ['path', 'activated', 'onAuthor', 'onPublish'])


        // Iterate through all assets and resynch:
        // a) if asset is marked as activated but not found on Publish, re-publish
        // b) if an asset is found on Publish that no longer is available on Author, de-publish
        // c) if an asset is marked as de-published but still found on publish, de-publish
        for (const asset of combinedLookup.values()){

            if(asset.activated && ! asset.onPublish){
                console.log(`${DRY} re-replicate: ${asset.path}`)
                await activate(asset.path)
            } else if(asset.onPublish && ! asset.onAuthor){
                console.log(`${DRY} orphaned:     ${asset.path}`)
                await deactivate(asset.path)
            } else if(asset.onPublish && ! asset.activated){
                console.log(`${DRY} deactivated:  ${asset.path}`)
                await deactivate(asset.path)
            }

        }

    } catch (error){
        console.log(error)
    }
}

// traverse the hierarchy given a start URL, if --tics is set, mark each call with character 't' 

async function traverse(href, t='x'){
    
    let entities = []

    // get all pages carrying entities
    let nextHref = href
    while(nextHref){
        debug(`fetching ${nextHref}`)
        tic(t)
        const page = await fetchPage(nextHref)
        entities = entities.concat(safeArray(page.entities))
        nextHref = getNextPageUrl(page)
    }

    let simpleEntities = entities.map(simplifyEntity) 

    //let assets = simpleEntities.filter(entity => entity.class === ASSET)
    let folders = simpleEntities.filter(entity => entity.class === FOLDER)
    
    for(let i = 0; i<folders.length; i++){
        const subAssets = await traverse(folders[i].href, t)
        simpleEntities = simpleEntities.concat(subAssets)
    }

    return simpleEntities

}

// Wrap null into empty array to avoid explicit null checks in higher level functs
function safeArray(a){
    if(a == null) return []
    return a
}


// Entities are stored in the assets API in a very unconventional way. Simplify struture to
// allow cleaner higher level functs

function simplifyEntity(entity){
    const originalHref = getLinkRelPropertyByName(entity, 'self', 'href')
    if(! originalHref) throw new EntityAssertionError(entity, 'no self href found')

    const url = new URL(originalHref)
    const href = `${url.protocol}//${url.host}${url.pathname}` 
    const path = url.pathname.replace(/\/api\/assets\/(.+)\.json/, "$1")
    
    
    if(entity.class.length != 1) throw new EntityAssertionError(entity, 'class not unique')

    return {
        class: entity.class[0],
        href, path 
    }
}

// lookup value in key-value array like [{key: 'mykey}, 'value': 'myvalue']
function getLinkRelPropertyByName(entity, relation, property){
    const links = entity.links

    const link = links.find(link => {
        return link.rel.find(rel => {
            if(rel === relation){
                return true
            }
        })
    })
    return link[property]
}


// get list of folders/assets from asset API. Undocumentedly, the API does not return all result in a single call,
// but a only 20 entities per call. So we have to get the resut page by page.

async function fetchPage(url){
    const response = await fetch(url, {
        method: 'GET',
        headers: AUTH_HEADER,
        agent: PROXYAGENT
    })

    if(response.ok){
        const data = await response.json()
        return data  
    } else{
        throw new HTTPResponseError(response)
    }
}

// extract next page from previous one

function getNextPageUrl(page){
    const links = page.links

    const next = links.find(link => {
        const rels = link.rel
        return rels.find(rel => {
            if(rel === 'next'){
                return true
            }
        })
    })
    return next?.href
}


// check replication status of individual asset or folder

async function getReplicationStatus(path){

    let url = AUTHOR + '/' + 'content/dam/' + path + '/jcr:content.0.json' 
    const response = await fetch(url, {
        method: 'GET',
        headers: AUTH_HEADER,
        agent: PROXYAGENT
    })

    if(response.ok){
        const data = await response.json()
        const active = data['cq:lastReplicationAction'] === 'Activate'
        return active  
    } else{
        return false
    }

}

// (re)active asset
async function activate(path){
    await delayActivateOrDeactivate(path, 'Activate')
}

// (de)active asset
async function deactivate(path){
    await delayActivateOrDeactivate(path, 'Deactivate')
}

// we do not want to clog the replication queue with thousands of requests during 
// production hours, so we introduce some waiting time in between activations or deactivations

async function delayActivateOrDeactivate(path, cmd){
    return new Promise((resolve, reject) => {
        setTimeout( () => {
            activateOrDeactivate(path, cmd)
            resolve()
        }, REPLICATION_DELAY)
    })
}

// activate or deactivate

async function activateOrDeactivate(path, cmd){
   
    if(DRYRUN){
        return
    }

    let url = AUTHOR + '/bin/replicate.json' 

    const headers = new Headers()
    headers.append('Authorization', AUTH_TOKEN)

    const body = new URLSearchParams()
    body.append('_charset_', 'utf-8')
    body.append('cmd', cmd)
    body.append('path', '/content/dam/' + path)

    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: body,
        agent: PROXYAGENT
    })

    if(response.ok){
        return  
    } else{
        throw new HTTPResponseError(response)
    }
} 


// Helper classes and functions

class HTTPResponseError extends Error {
	constructor(response) {
		super(`HTTP Error Response: ${response.status} ${response.statusText}`);
		this.response = response;
	}
}

class EntityAssertionError extends Error {
	constructor(entity, error) {
		super(`Entity Assertion Error: ${error} ${JSON.stringify(entity)}`);
		this.entity = entity;
	}
}



function tic(t){
    if(TICS) process.stdout.write(t)
}

function debug(s){
    if(DEBUG) console.log(s)
}


// CLI Arg handling

function getArgs(){

    return yargs(process.argv.slice(2))
    
    .option( 'author', {
        describe: 'the hostname of author system to compare, e.g. http://localhost:4502 ', 
        demandOption: true,
        type: 'string' 
        
    })
    .option( 'publish', {
        describe: 'the hostname of publish system to compare, e.g. http://publish:4503 ', 
        demandOption: true,
        type: 'string' 
    })
    .option( 'proxy', {
        describe: 'URL of a proxy server in case you want to debug (error handling is not well implemented, yet), e.g. http://localhost:9999 ', 
        demandOption: false,
        type: 'string'   
    })
    .option( 'path', {
        describe: 'root path of where to start the comparison. Path is considered to be below /content/dam. E.g. /myfolder ', 
        demandOption: true,
        type: 'string' 
        
    })
    .option( 'user', {
        describe: 'user with proper privileges, e.g. admin', 
        demandOption: true,
        type: 'string' 
    })
    .option( 'password', {
        describe: 'password of user, e.g. mysecretpassword', 
        demandOption: true,
        type: 'string' 
    })
    .option( 'resynch', {
        describe: 'set this flag if you actually want to synch author and publish. if not set, the script will do a dry-run, only',
        type: 'boolean' 
    })
    .option( 'tics', {
        describe: 'show progress tics: a/p: traverse hierarchy on author, d: fetch details from author',
        type: 'boolean'
    })
    .option( 'delay', {
        describe: 'to not clog the replication queue, we put in a delay of 5000ms between each activation / deactivation. Increase or reduce at will',
        default: '5000',
        type: 'number' 
    })
    .option( 'debug', {
        describe: 'set if you want more verbose responses',
        type: 'boolean' 
    })
    .option( 'allowinsecure', {
        describe: 'set if your HTTPS certificte is not signed properly',
        type: 'boolean' 
    })
    .argv
    
}