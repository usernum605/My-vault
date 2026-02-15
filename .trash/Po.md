ساعدني في عمل commit لخزنتي في تطبيق اوبسيديان عبر Termux
هذا هو حسابي على قيت هاب: https://github.com/usernum605
وهذا هو الريبو الذي اريد استخدامه: https://github.com/usernum605/My-vault
الأوامر التي كتبتها حتى الآن
```bash
 ┌─╼[CODEX〄Admin]-[~]
 └────╼ ❯❯❯ pwd                                                     [] 3:39:12 - PM
/data/data/com.termux/files/home

 ┌─╼[CODEX〄Admin]-[~]
 └────╼ ❯❯❯ cd shared                                               [] 3:39:41 - PM
cd: no such file or directory: shared

 ┌─╼[~]
 └╼ ❯❯❯ cd storage/                                                 [] 3:39:48 - PM

 ┌─╼[CODEX〄Admin]-[~/storage]
 └────╼ ❯❯❯ cd obsidian n                                           [] 3:39:56 - PM
cd: string not in pwd: obsidian

 ┌─╼[~/storage]
 └╼ ❯❯❯ cd obsidian                                                 [] 3:40:03 - PM
cd: no such file or directory: obsidian

 ┌─╼[~/storage]
 └╼ ❯❯❯ cd obsidian                                                 [] 3:40:11 - PM
cd: no such file or directory: obsidian

 ┌─╼[~/storage]
 └╼ ❯❯❯ ls                                                          [] 3:40:20 - PM
 shared

 ┌─╼[CODEX〄Admin]-[~/storage]
 └────╼ ❯❯❯ cd shared                                               [] 3:40:23 - PM

 ┌─╼[CODEX〄Admin]-[~/storage/shared]
 └────╼ ❯❯❯ cd obsidian                                             [] 3:40:31 - PM

 ┌─╼[CODEX〄Admin]-[~/storage/shared/obsidian]
 └────╼ ❯❯❯ cd 'obsidian n'                                         [] 3:40:36 - PM

 ┌─╼[CODEX〄Admin]-[~/…/obsidian/obsidian n]
 └────╼ ❯❯❯ pwd                                                     [] 3:40:48 - PM
/data/data/com.termux/files/home/storage/shared/obsidian/obsidian n

 ┌─╼[CODEX〄Admin]-[~/…/obsidian/obsidian n]
 └────╼ ❯❯❯ proot-distro login ubuntu                               [] 3:40:58 - PM
root@localhost:~# cd /storage/shared/obsidian/obsidian n
bash: cd: too many arguments
root@localhost:~# cd /storage/shared/obsidian/
bash: cd: /storage/shared/obsidian/: No such file or directory
root@localhost:~# ls
hypervault  shared
root@localhost:~# cd shared/obsidian/obsidian n
bash: cd: too many arguments
root@localhost:~# pwd
/root
root@localhost:~# cd /data/data/com.termux/files/home/storage/shared/obsidian/obsidian
root@localhost:/data/data/com.termux/files/home/storage/shared/obsidian/obsidian# ls
'learn English.md'      'Self Education.md'
'Learn java script.md'   Side
'Learn programming.md'   Tags
'Learn python.md'       'The most important points of my video.md'
'My books.md'           'Tracker my day.md'
'My hidden files'        Vault.md
'My tools.md'           'أحكام التجويد.canvas'
'Quick notes.md'         ديني.md
root@localhost:/data/data/com.termux/files/home/storage/shared/obsidian/obsidian# cd ..
root@localhost:/data/data/com.termux/files/home/storage/shared/obsidian# ls
 Important   Obsidian  'Obsidian N'
root@localhost:/data/data/com.termux/files/home/storage/shared/obsidian# cd 'Obsidian N'
root@localhost:/data/data/com.termux/files/home/storage/shared/obsidian/Obsidian N#
```