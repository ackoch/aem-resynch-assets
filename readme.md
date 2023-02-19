 

Options:
  --help           Show help                                           [boolean]
  --version        Show version number                                 [boolean]
  --author         the hostname of author system to compare, e.g. http://localh
                   ost:4502                                  [string] [required]
  --publish        the hostname of publish system to compare, e.g. http://publi
                   sh:4503                                   [string] [required]
  --proxy          URL of a proxy server in case you want to debug (error handl
                   ing is not well implemented, yet), e.g. http://localhost:999
                   9                                                    [string]
  --path           root path of where to start the comparison. Path is consider
                   ed to be below /content/dam. E.g. /myfolder
                                                             [string] [required]
  --user           user with proper privileges, e.g. admin   [string] [required]
  --password       password of user, e.g. mysecretpassword   [string] [required]
  --resynch        set this flag if you actually want to synch author and publis
                   h. if not set, the script will do a dry-run, only   [boolean]
  --tics           show progress tics: a/p: traverse hierarchy on author, d: fet
                   ch details from author                              [boolean]
  --delay          to not clog the replication queue, we put in a delay of 5000m
                   s between each activation / deactivation. Increase or reduce
                   at will                            [number] [default: "5000"]
  --debug          set if you want more verbose responses              [boolean]
  --allowinsecure  set if your HTTPS certificte is not signed properly [boolean]