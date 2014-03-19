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
              var mode = "line";

              self.ev.on("keypress", function(chunk, key) {
                if (mode == "write")
                {
                  if (chunk == '\u001d')
                  {
                    console.log("Write mode has been disabled.");
                    mode = "line";
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
                else if (key.name == 'l')
                {
                  mode = (mode == "line") ? "stream" : "line";
                  console.log("Mode has been switched to ``%s''.", mode);
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
                  mode = "write";
                }
                else
                  self.ev.fire("hotkey", key, chunk);
              });
              var tails = {};
              var heads = {};
              var ostream = function(key, data)
              {
                if (mode == "line")
                  console.log("%s: %s", key, data.trim());
                else if (mode == "stream")
                {
                  heads[key] = heads[key] || (tails[key] && tails[key].length) || 0;
                  tails[key] = (tails[key] || "") + data;
                  for (var k in tails)
                  {
                    if (tails[k].length >= ostream.MAX)
                    {
                      heads[k] -= tails[k].length - ostream.MAX;
                      tails[k] = tails[k].substr(-ostream.MAX);
                    }
                  }
                }
              };
              ostream.MAX = 512;
              var loop = function()
              {
                return self.napi("session/" + sid + "/read")
                  .spread(function(key, type, data) {
                    switch(type)
                    {
                      case null:
                        ostream(key, data);
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
        if (!this.rl)
          process.stdout.write("\n");
        if (this.running)
          console.log('Have a great day!');
        this.running = false;
        return Q.resolve();
      }
    };

    var config = function config_data(key, value) {
      var current = this.config;
      var prev, prevkey;
      (key || "").split(".").forEach(function(c) {
        if (!current && typeof(value) != 'undefined')
          current = prev[prevkey] = {};
        prev = current;
        if (current)
          current = current[c];
        prevkey = c;
      });
      if (typeof(value) != 'undefined')
        prev[prevkey] = value;
      return current;
    };

    config.user = process.env.USER || 'root';
    config.interactive = true;
    config.server = "::1";
    config.server_port = 53353;
    config.plugin_dir = path.join(path.dirname(__filename), "..", "plugins");

    this.config = config;

    this.hooks = {
      start: [],
      exit: []
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
    var defer = Q.defer();
    var stop = function() { 
      self.running = false; 
      defer.resolve();
    };
    var prevhistory = self.rl && self.rl.history;
    self.rl = readline.createInterface(process.stdin, process.stdout);
    if (prevhistory)
      self.rl.history = prevhistory;
    self.running = true;
    self.prompt();
    self.rl.on('line', function(line) {
      self.rl.removeListener('close', stop);
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
          if(self.running)
            self.start();
          else
          {
            self.rl.removeListener('close', stop);
            stop();
          }
        }).done();
    });
    self.rl.on('close', stop);
    self.rl.on('SIGINT', function() {
      console.log("SIGINT");
    });
    return defer.promise;
  };

  module.exports.prototype.argshift = argshift;
}());
