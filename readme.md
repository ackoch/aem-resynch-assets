# resynchronize assets

 A tool to re-synchronize assets between Author and Publish on Adobe Experience Manager (AEM)

## The problem

When publishing or de-publishing assets in AEM  from Author to the Publish System, the according asset or de-activaition command is placed into a replication queue from where it is distributed to the various Publish systems, thus Author and Publish are eventual consistent.

There are some exceptional cases, where this schema can fail and Author and Publish begin to become out of synch. These situations can come from misconfigurations in older versions of AEM or result from a faulty state. In the past, I have observerd the following conditions.. but you could easily imagine other circumstances.

- Publish system becomes unresponsive and the replication queue clogs up. A system administrator manually deletes the replication queue, deleting the synchronization events

- A user moves an asset from one folder to another. This should result in sequence like 

  - de-activate A
  - copy A->B
  - delete A
  - activate B

  Now, when the current user, does not have replication rights, the de-activation might get lost (e.g. in an ingored request for deactivate workflow). Thus the asset A at the old location is orphaned

AEM does not provide a means to easily re-synchronize Author and Publish. They both keep unrelated copies.

AEM offers to tree-activate a folder, but this only re-activates assets and does not remove orphans or supposedly de-activated assets.

## The Solution 

This script uses the [Asset API](https://experienceleague.adobe.com/docs/experience-manager-65/assets/extending/mac-api-assets.html) to traverse a folder hierarchy on Author and Publish. It also checks the supposed status (activated/deactivated) on the author. It compares the result and

- if asset is marked as activated but not found on Publish, it triggers a re-publish

- if  if an asset is found on Publish that no longer is available on Author, it considers the asset on Publish orphaned and triggers a de-publish
- if an asset is marked as de-published but still found on publish, it triggers a de-publish 



## Usage

### Example

```
$ node resynch.js \
--author https://author:4502 \
--publish https://publish:4503 \
--user admin \
--password admin \
--proxy http://localhost:9999 \
--path '/brand-marketing/2023' \
--resynch \
--tics > logs/resynch.log 
```



### Command Line Options

| Parameter       | Desciption                                                   | Example               |
| --------------- | ------------------------------------------------------------ | --------------------- |
| --help          | Show help                                                    |                       |
| --author        | Hostname of Author system to compare                         | http://localhost:4502 |
| --publish       | Hostname of Publish system to compare                        | http://localhost:4503 |
| --proxy         | URL of a proxy server in case you want to debug (error handling is not very mature, so in case something breaks, you could for example use [Charles](https://www.charlesproxy.com) proxy to debug), | http://localhost:9999 |
| --path          | root path of where to start the comparison. Path is considered to be below /content/dam | /myfolder             |
| --user          | user with proper privileges                                  | admin                 |
| --password      | password                                                     | adminpassword         |
| --resynch       | By default, the script runs in drymode, and emits a report, only. Set this flag if you actually want to *synch* Author and Publish |                       |
| --tics          | Show progress tics on the command line                       |                       |
| --debug         | set if you want more verbose responses                       |                       |
| --delay         | To not clog the replication queue, by defaukt we put in a delay of 5000ms between each activation / deactivation. Increase or reduce at will. |                       |
| --allowinsecure | Development machines might not have a proper HTTPS certificate. Set this option if you want the script to ignore if your HTTPS certificte is not signed properly. This flag is set implictly when using a proxy. This makes the script vulnerable to man-in-the-middle attacks, so handle with care in production. |                       |

## Requirements and Installation

This script requires a recent version of node.js to run. I have developed and tested on **Node.js v18.0.**  

This script has a couple of npm dependencies, so  you have to initialize first after checkout

```
$ npm install
```

## Considerations

This script is a pragmantic if one-off approach. Some companies require to pass elaborate QA processes before you install new software. For the task at hand, that seemed to be too much hassle.. And I wanted to have a tool that I can run on any version of AEM. So I chose an approach using external URLs, only. 

Plus: As an architect i am working conceptually most of the time and, my coding skills have become a bit rusty. I wanted to re-fresh my JavaScipt skills. Python would have been a good alternative, as most administrators more likely have an Python interpreter installed than Node.js. Though there  is a shift towards JavaScript in the Adobe world (i.e. [App Builder](https://business.adobe.com/products/experience-manager/developer-app-builder.html) and AIO CLI are JS-based). So, I thought it could be worthwhile to invest here, too.   

## Limitiations and Lessons Learned

- The script supports **basic-auth**, only. This is available on most installations including AEM as a Cloud Service (AEMaaCS). For AEMaaCS this is not best practice - but you can still create local users and log in locally. A future version might add a more elaborate authentication. For the tim being, make sure to only use HTTPS to not compromise login credentials.
-  The script compares the Author only with **one Publish**. You can run it multiple times, though.
- The script **resynchs assets, only**. Pages within *Sites* might have the same issue. I'll augment the script whenever I face the issue in a Sites project
- The script **re-publishes modified assets** even when they are. That means if someone has made changes to assets after they have been published, these changes are published no matter what and might circumvent approval workflows that are in place. In my experience, assets are rarely altered after publication - so I found that acceptable. This would have to be re-evaluated when augmenting the script  to Pages.
- **The script is slow.** It is best executed against smaller batches and run in the background. Making external API requests is slow - compared to a native AEM implementation that would run on the server. For my purpose (see "Considerations") it was good enough - but I do not claim this is best practice. The script runs sequential and does not parallelize requests. While this could have sped up the execution, I wanted to a) keep things simple and b) did not want to fire hundreds parallel requests and clog up the Author system in production. For the future, I am planning to 
  - use search instead of crawling  
  - implement rate limiting, that could control how  many requests the Sling script can fire in parallel. Stay tuned.
- If you need to speed-up run in parallel, you can start two or more **batches in parallel.** 

### Roadmap

It's always good to have plans, right? I would like to...

- Integrate into AIO CLI
- Make the script avaiable as command on npm
- Support "Sites"
- Improve performance

