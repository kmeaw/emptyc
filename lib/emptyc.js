// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";

  var Q = require('q');
  var http = require('http');
  var readline = require('readline');
  var colors = require("colors");
  var EventEmitter = require('events').EventEmitter;
  var path = require("path");
  var NodeCache = require("node-cache");
  var spawn = require('child_process').spawn;

  function argshift(line) {
    if (!line)
      return {'car':''};
    line = line.trim();
    var e = /\s/.exec(line);
    if (!e)
      return {'car':line};
    else
      return {'car':line.slice(0, e.index).trim(), 'cdr':line.slice(e.index).trim()};
  }

  module.exports = function Emptyc() {
    this.cache = new NodeCache({checkperiod: 120});

    this.commands = {
      '': function() {
        return Q.resolve();
      },

      notfound: function(car) {
        return function() { return Q.reject("Invalid command: " + car); };
      },

      toggle: function(car) {
        var value = this.config(car);
        this.config(car, !value);
        console.log("%s has been set to %s.", car, !value);
        return Q.resolve();
      },

      su: function(car) {
        var prevuser = this.config.user;
        this.config.user = car || this.prevuser || "root";
        this.prevuser = prevuser;
        console.log("User has been set to ``%s''.", this.config.user);
        return Q.resolve();
      },

      ssh: function(car) {
        var deferred = Q.defer();
        process.stdin.setRawMode(false);
        process.stdin.pause();
        var client = spawn("ssh", [
            "-oStrictHostKeyChecking=no", "-oUserKnownHostsFile=/dev/null",
            "-l", this.config.user,
            car
          ], { stdio: "inherit" });
        var inthandler = function() {
          client.kill('SIGINT');
        };
        process.on('SIGINT', inthandler);
        client.on('close', function(code) {
          process.stdin.resume();
          process.removeListener('SIGINT', inthandler);
          if (code !== 0)
            deferred.reject("SSH exited with code " + code);
          else
            deferred.resolve();
        });
        return deferred.promise;
      },

      run: function(a) {
        var cell = argshift(a);
        var t = Date.now();
        var aborted = false;
        var self = this;
        var pending_hosts = [];

        return Q.resolve(cell.car.split(',')).then(function(keys) {
          var run_keys;
          if (!self.config.parallel)
          {
            pending_hosts = keys.slice(0);
            run_keys = [pending_hosts.shift()];
          }
          else
            run_keys = keys;

          return [keys, self.napi("session/new", JSON.stringify({keys: run_keys, interactive: !!self.config.interactive}))];
        }).spread(function(keys, session) {
          return self.napi("session/" + session.id + "/run", cell.cdr)
            .then(function() {
              var exits = {};
              var failures = {};
              var mode = "line";

              var inthandler = function() {
                aborted = true;
                return self.napi("session/" + session.id, false, "DELETE").done();
              };

              process.on('SIGINT', inthandler);

              self.ev.on("keypress", function(chunk, key) {
                if (mode == "write")
                {
                  if (chunk == '\u001d')
                  {
                    console.log("Write mode has been disabled.");
                    mode = "line";
                  }
                  else
                    self.napi("session/" + session.id + "/write", chunk).done();

                  return;
                }
                else if (key)
                {
                  if (key.name == 'q')
                  {
                    aborted = true;
                    return self.napi("session/" + session.id, false, "DELETE").done();
                  }
                  else if (key.name == 's')
                  {
                    return self.napi("session/" + session.id)
                      .then(function(s) { console.log(s); })
                      .done();
                  }
                  else if (key.name == 'l')
                  {
                    mode = (mode == "line") ? "stream" : "line";
                    return console.log("Mode has been switched to ``%s''.", mode);
                  }
                  else if (key.name == 'k')
                  {
                    return self.napi("session/" + session.id)
                      .then(function(s) {
                        var k;
                        for(k in s.children)
                          if (s.children[k] == "running" || s.children[k] == "pending")
                            break;
                        console.log("Terminating %s in %s", k, session.id);
                        return self.napi("session/" + session.id + "/terminate", k);
                      })
                      .done();
                  }
                  else if (key.name == 'w')
                  {
                    console.log("Entering write mode, escape character is ^].");
                    mode = "write";
                  }
                }

                self.ev.emit("hotkey", key, chunk);
              });
              var tails = {};
              var heads = {};
              var ostream = function(key, data)
              {
                if (mode == "line" || mode == "write")
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
                return self.napi("session/" + session.id + "/read")
                  .spread(function(key, type, data) {
                    switch(type)
                    {
                      case null:
                        if (self.config.parallel)
                          ostream(key, data);
                        else
                          process.stdout.write(data);
                        break;
                      case 1:
                        if (self.config.parallel)
                          console.warn("%s! %s", key, data.trim().red);
                        else
                          process.stderr.write(data);
                        break;
                      case "start":
                        if (!self.config.parallel)
                          console.log("=== " + key + " ===");
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
                          if (pending_hosts.length == 0)
                          {
                            process.removeListener('SIGINT', inthandler);
                            console.log("Run took %d ms, %d hosts have failed", 
                                Date.now() - t, 
                                Object.keys(exits).filter(function(k){return exits[k] !== 0;}).length);
                            return aborted ? Q.resolve() : self.napi("session/" + session.id, false, "DELETE");
                          }
                          else if (!aborted)
                          {
                            var run_keys = [pending_hosts.shift()];
                            return self.napi("session/new", JSON.stringify({keys: run_keys, interactive: !!self.config.interactive})).then(function(s) {
                              session.id = s.id;
                              return self.napi("session/" + session.id + "/run", cell.cdr);
                            }).then(function() {
                              return loop();
                            });
                          }
                          else
                          {
                            process.removeListener('SIGINT', inthandler);
                            return Q.resolve();
                          }
                        }
                        else if (!(key in exits))
                        {
                          failures[key] = true;
                          console.warn("%s! connection aborted", key.red);
                        }
                        if (!self.config.parallel)
                          console.log("");
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
        });
      },

      exit: function() {
        if (!this.rl)
          process.stdout.write("\n");
        if (this.running && process.stdin.isTTY)
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
    config.interactive = false;
    config.server = "::1";
    config.server_port = 53353;
    config.plugin_dir = path.join(path.dirname(__filename), "..", "plugins");
    config.parallel = true;

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

  module.exports.prototype.exec = function(line) {
    var cell = argshift(line);
    var cmd = this.commands[cell.car] || this.commands.notfound(cell.car);
    return cmd.apply(this, [cell.cdr])
  };

  module.exports.prototype.completer = function(line, callback) {
    var cell = argshift(line);
    var cmd = this.commands[cell.car];

    if (cmd)
    {
      if (cmd.completer)
        cmd.completer(cell.cdr, function(cdrs) { 
            callback(null, [cdrs.map(function(e) { return cell.car + " " + e; }), line]) 
          }, callback);
      else
        callback(null, [[], line]);
    }
    else
      callback(null, [Object.keys(this.commands).map(function(c) {
          return c + " ";
        }).filter(function(c) {
          return c.indexOf(cell.car) == 0;
        }), line]);
  };

  module.exports.prototype.start = function(defer) {
    var self = this;
    defer = defer || Q.defer();
    var stop = function() { 
      self.running = false; 
      defer.resolve();
    };
    var prevhistory = self.rl && self.rl.history;
    self.rl = readline.createInterface({input:process.stdin, output:process.stdout, completer:self.completer.bind(self)});
    if (prevhistory)
      self.rl.history = prevhistory;
    self.running = true;
    if (process.stdin.isTTY)
      self.prompt();
    else
      process.stdin.on('end', stop);
    self.rl.on('line', function(line) {
      self.ev = new EventEmitter();
      var keypress = function keypress(chunk, key) {
        self.ev.emit("keypress", chunk, key);
      };
      if (process.stdin.isTTY)
      {
        self.rl.removeListener('close', stop);
        self.rl.close();
        process.openStdin();
        process.stdin.setRawMode(true);
        process.stdin.on("keypress", keypress);
      }
      self.exec(line)
        .then(function() { }, function(e) { console.error(e); })
        .fin(function() { 
          if (process.stdin.isTTY)
          {
            process.stdin.removeListener("keypress", keypress); 
            if(self.running)
              self.start(defer);
            else
            {
              self.rl.removeListener('close', stop);
              stop();
            }
          }
          else if (!self.running)
            stop();
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
