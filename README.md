emptyd node.js client implementation

### Commands

 - toggle boolean.config.option
 - su [user]
 - ssh hostname
 - run host1,host2,host3 command --with arguments
 - exit

### Planned features

 - [ ] aggregate multiple hosts output (mode == "stream");
 - [ ] job control (jobs, ctrl-z, fg);
 - [ ] escalator support (https://github.com/kmeaw/escalator);
 - [x] resolver plugin API;
 - [ ] switch to single host during session;
 - [ ] logging facility;
 - [x] serial mode;

### How to install

npm install emptyc

### Random notes

  - you can enable readline in GNU/Linux: {"readline": {"enabled": true}}
