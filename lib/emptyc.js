// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";

  var Q = require('q');
  var http = require('http');
  var readline = require('readline');
  var colors = require("colors");
  var EventEmitter = require('events').EventEmitter;
  var path = require("path");

  function argshift(line) {
    if (!line)
      return line;
    line = line.trim();
    var e = /\s/.exec(line);
    if (!e)
      return {'car':line};
    else
      return {'car':line.slice(0, e.index).trim(), 'cdr':line.slice(e.index).trim()};
  }

  module.exports = function Emptyc() {
    this.commands = {
      undefined: function() {
        return Q.resolve();
      },

      notfound: function(car) {
        return function() { return Q.reject("Invalid command: " + car); };
      },

      su: function(car) {
        var prevuser = this.config.user;
        this.config.user = car || this.prevuser || "root";
        this.prevuser = prevuser;
        console.log("User has been set to ``%s''.", this.config.user);
        return Q.resolve();
      },

      run: function(a) {
        var cell = argshift(a);
        var t = Date.now();
        var aborted = false;
        var self = this;

        return Q.resolve(cell.car.split(',')).then(function(keys) {
          return [keys, self.napi("session/new", JSON.stringify({keys: keys, interactive: !!self.interactive}))];
        }).spread(function(keys, session) {
          var sid = session.id;
          return self.napi("session/" + sid + "/run", cell.cdr)
            .then(function() {
              var exits = {};
              var failures = {};
              var write_mode = false;
              self.ev.on("keypress", function(chunk, key) {
                if (write_mode)
                {
                  if (chunk == '\u001d')
                  {
                    console.log("Write mode has been disabled.");
                    write_mode = false;
                  }
                  else
                    self.napi("session/" + sid + "/write", chunk).done();
                }
                else if (key.name == 'q')
                {
                  aborted = true;
                  self.napi("session/" + sid, false, "DELETE").done();
                }
                else if (key.name == 's')
                {
                  self.napi("session/" + sid)
                    .then(function(s) { console.log(s); })
                    .done();
                }
                else if (key.name == 'k')
                {
                  self.napi("session/" + sid)
                    .then(function(s) {
                      var k;
                      for(k in s.children)
                        if (s.children[k] == "running" || s.children[k] == "pending")
                          break;
                      console.log("Terminating %s in %s", k, sid);
                      return self.napi("session/" + sid + "/terminate", k);
                    })
                    .done();
                }
                else if (key.name == 'w')
                {
                  console.log("Entering write mode, escape character is ^].");
                  write_mode = true;
                }
                else
                  self.ev.fire("hotkey", key, chunk);
              });
              var loop = function()
              {
                return self.napi("session/" + sid + "/read")
                  .spread(function(key, type, data) {
                    switch(type)
                    {
                      case null:
                        console.log("%s: %s", key, data.trim());
                        break;
                      case 1:
                        console.warn("%s! %s", key, data.trim().red);
                        break;
                      case "start":
                        break;
                      case "dead":
                        var keys = key ? [key] : data;
                        keys.forEach(function(key) {
                          console.warn("%s! connection failed", key.red);
                          failures[key] = true;
                          exits[key] = -1;
                        });
                        break;
                      case "error":
                        console.warn("%s %s %s", key, "<error>".bold, data ? data.trim().red : "");
                        break;
                      case "done":
                        if (key === null)
                        {
                          console.log("Run took %d ms, %d hosts have failed", 
                              Date.now() - t, 
                              Object.keys(exits).filter(function(k){return exits[k] !== 0;}).length);
                          return Q.resolve(sid);
                        }
                        else if (!(key in exits))
                        {
                          failures[key] = true;
                          console.warn("%s! connection aborted", key.red);
                        }
                        break;
                      case "exit":
                        exits[key] = data;
                        if (data !== 0)
                          console.warn("%s (exit %d)", key.red, data);
                        break;
                      default:
                        console.log("%s[%s] %s", key, type, data);
                        break;
                    }
                    return loop();
                  });
              };
              return loop();
            });
        }).then(function(sid) {
          return aborted ? Q.resolve() : self.napi("session/" + sid, false, "DELETE");
        });
      },

      exit: function() {
        process.stdout.write("\n");
        console.log('Have a great day!');
        process.exit(0);
      }
    };

    this.config = {
      "user": process.env.USER || 'root',
      "interactive": true,
      "server": "::1",
      server_port: 53353,
      plugin_dir: path.join(path.dirname(__filename), "..", "plugins")
    };

    this.rl = null;
  };

  module.exports.prototype.prompt = function() {
    this.rl.setPrompt("emptyc> ");
    this.rl.prompt();
  };

  module.exports.prototype.napi = function napi(path, data, method)
  {
    var deferred = Q.defer();

    var options = {
      hostname: this.config.server,
      port: this.config.server_port,
      path: '/' + path,
      method: 'GET'
    };

    if (data)
    {
      options.method = 'POST';
      options.headers = {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      };
    }

    if (method)
      options.method = method;

    var req = http.request(options, function(res) {
      var body = "";
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        body += chunk;
      });
      res.on('end', function() {
        if (res.statusCode == 200)
          deferred.resolve(JSON.parse(body));
        else
          deferred.reject(JSON.parse(body));
      });
    });

    req.on('error', function(e) {
      deferred.reject(e);
    });

    if (data)
      req.write(data);
    req.end();

    return deferred.promise;
  };

  module.exports.prototype.start = function() {
    var self = this;
    var prevhistory = self.rl && self.rl.history;
    self.rl = readline.createInterface(process.stdin, process.stdout);
    if (prevhistory)
      self.rl.history = prevhistory;
    self.running = true;
    self.prompt();
    self.rl.on('line', function(line) {
      self.rl.removeListener('close', self.commands.exit);
      self.rl.close();
      process.openStdin();
      process.stdin.setRawMode(true);
      self.ev = new EventEmitter();
      var keypress = function keypress(chunk, key) {
        self.ev.emit("keypress", chunk, key);
      };
      process.stdin.on("keypress", keypress);
      var cell = argshift(line);
      var cmd = self.commands[cell.car] || self.commands.notfound(cell.car);
      cmd.apply(self, [cell.cdr])
        .then(function() { }, function(e) { console.error(e); })
        .fin(function() { 
          process.stdin.removeListener("keypress", keypress); 
          self.ev.removeAllListeners();
          if(self.running)
            self.start();
        }).done();
    });
    self.rl.on('close', self.commands.exit);
    self.rl.on('SIGINT', function() {
      console.log("SIGINT");
    });
  };

  module.exports.prototype.argshift = argshift;
}());
