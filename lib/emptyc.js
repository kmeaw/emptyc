// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";

  var Q = require('q');
  var http = require('http');
  var NodeCache = require("node-cache");
  var util = require("util");

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
        this.ev.emit("info", util.format("%s has been set to %s.", car, !value));
        return Q.resolve();
      },

      su: function(car) {
        var prevuser = this.config.user;
        this.config.user = car || this.prevuser || "root";
        this.prevuser = prevuser;
        this.ev.emit("info", util.format("User has been set to ``%s''.", this.config.user));
        return Q.resolve();
      },

      help: function() {
        for(var c in this.commands) {
          if (!c || c == "notfound") continue;
          var cmd = this.commands[c];
          this.ev.emit("info", util.format("%s %s", c, cmd.help || ""));
        }
        return Q.resolve();
      },

      run: function(a) {
        var cell = argshift(a);
        var t = Date.now();
        var aborted = false;
        var self = this;
        var pending_hosts = [];
        var ev = this.ev;
        var progress_done = 0;
        var progress_total;

        return this.resolve(cell.car.split(',')).then(function(keys) {
          keys = keys.map(function(h){return h.indexOf("@") == -1 ? self.config.user + "@"+h : h;});
          var run_keys;
          if (!self.config.parallel)
          {
            pending_hosts = keys.slice(0);
            run_keys = [pending_hosts.shift()];
          }
          else
            run_keys = keys;

          progress_total = keys.length;
          return [keys, self.napi("session/new", JSON.stringify({keys: run_keys, interactive: !!self.config.interactive}))];
        }).spread(function(keys, session) {
          var sudo = "";
          var cmd = cell.cdr;
          if (self.config.sudo)
          {
            if (~cmd.indexOf("#sudo#"))
              cmd = cmd.replace(/#sudo#/, "sudo");
            else if (cmd.indexOf("sudo") != 0)
              cmd = "sudo sh -c $" + util.inspect(cmd);
          }
          else if (~cmd.indexOf("#sudo#"))
            cmd = cmd.replace(/#sudo#\s*/, '');
          return self.napi("session/" + session.id + "/run", cmd)
            .then(function() {
              var exits = {};
              var failures = {};
              self.mode = self.config("mode");

              ev.on("abort-session", function() {
                aborted = true;
                self.napi("session/" + session.id, false, "DELETE").done();
              });

              ev.on("show-status", function() {
                self.napi("session/" + session.id)
                  .then(function(s) { ev.emit("info", s); })
                  .done();
              });

              ev.on("write", function(chunk) {
                self.napi("session/" + session.id + "/write", chunk).done();
              });

              ev.on("set-mode", function(new_mode) {
                self.mode = new_mode;
                ev.emit("info", util.format("Mode has been switched to ``%s''.", self.mode));
              });

              ev.on("kill-child", function(key) {
                self.napi("session/" + session.id)
                  .then(function(s) {
                    var k = key;
                    if (!k)
                    {
                      for(k in s.children)
                        if (s.children[k] == "running" || s.children[k] == "pending")
                          break;
                    }
                    ev.emit("info", util.format("Terminating %s in %s", k, session.id));
                    return self.napi("session/" + session.id + "/terminate", k);
                  })
                  .done();
              });

              var loop = function()
              {
                return self.napi("session/" + session.id + "/read")
                  .spread(function(key, type, data) {
                    switch(type)
                    {
                      case null:
                        ev.emit("output", data, key);
                        break;
                      case 1:
                        ev.emit("output", data.trim(), key, "stderr");
                        break;
                      case "start":
                        ev.emit("start", key);
                        break;
                      case "dead":
                        var keys = key ? [key] : data;
                        keys.forEach(function(key) {
                          ev.emit("warn", "connection failed", key);
                          failures[key] = true;
                          exits[key] = -1;
                        });
                        break;
                      case "error":
                        ev.emit("warn", data.trim(), key);
                        break;
                      case "done":
                        if (key === null)
                        {
                          if (pending_hosts.length == 0)
                          {
                            var failed = Object.keys(exits).filter(function(k){return exits[k] !== 0;});
                            return (aborted ? Q.resolve() : self.napi("session/" + session.id, false, "DELETE")).then(function() {
                              ev.emit("info", util.format("Run took %d ms, %d hosts have failed", 
                                  Date.now() - t, 
                                  failed.length));
                              if (failed.length > 0)
                                return Q.reject("Failed hosts: " + failed.join(','));
                            });
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
                            return Q.resolve();
                          }
                        }
                        else if (!(key in exits))
                        {
                          failures[key] = true;
                          ev.emit("warn", "connection aborted", key);
                        }
                        ev.emit("end", key);
                        break;
                      case "exit":
                        ev.emit("exit", key, data);
                        if (!(key in exits))
                          ev.emit("progress", ++progress_done, progress_total);
                        exits[key] = data;
                        break;
                      default:
                        ev.emit("output", data, key, type);
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
        this.running = false;
        return Q.resolve();
      },

      resolve: function(car) {
        var ev = this.ev;
        return this.resolve(car.split(',')).then(function(hosts) {
          hosts.forEach(function(h) { ev.emit("info", h); });
        });
      },
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
    config.parallel = true;
    config.mode = "line";

    this.config = config;

    this.hooks = {
      start: [],
      exit: []
    };

    this.aliases = {};
    this.completers = {};
    this.resolvers = [];
  };

  module.exports.prototype.prompt = function() {
    return "emptyc> ";
  };

  module.exports.prototype.resolve = function (input) {
    return this.resolvers.reduce(function(r,s) { return r.then(function(e) { return Q.all(e.map(s)) }).then(function(e) { return [].concat.apply([], e)}); }, Q(input)).then(function(hs) {
      var positive = hs.filter(function(h) { return h[0] != '-'; });
      var negative = hs.filter(function(h) { return h[0] == '-'; }).map(function(h) { return h.substr(1); });
      var uniq = {};
      return positive.filter(function(h) {
        var is_unique = (uniq[h] === undefined && negative.indexOf(h) == -1);
        uniq[h] = true;
        return is_unique;
      });
    });
  };

  module.exports.prototype.napi = function napi(path, data, method)
  {
    var deferred = Q.defer();

    var options = {
      hostname: this.config.server,
      port: this.config.server_port,
      path: '/' + path,
      method: 'GET',
      headers: {}
    };

    if (data)
    {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json'
      options.headers['Content-Length'] = data.length
    }

    if (this.config.cookie)
      options.headers['Authorization'] = 'Cookie: ' + this.config.cookie;

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
    var cmd;
    if (this.aliases[cell.car])
      cmd = this.commands[this.aliases[cell.car]];
    else
      cmd = this.commands[cell.car];
    cmd = cmd || this.commands.notfound(cell.car);
    return cmd.apply(this, [cell.cdr])
  };

  module.exports.prototype.completer = function(line, callback) {
    var cell = argshift(line);
    var name = cell.car;
    if (this.aliases[cell.car])
      name = this.aliases[cell.car];
    var cmd = this.commands[name];

    if (cmd)
    {
      if (this.completers[name])
        this.completers[name](cell.cdr, function(cdrs) { 
            callback(null, [cdrs.map(function(e) { return cell.car + " " + e; }), line]) 
          }, callback);
      else
        callback(null, [[], line]);
    }
    else
      callback(null, [Object.keys(this.commands).concat(Object.keys(this.aliases)).map(function(c) {
          return c + " ";
        }).filter(function(c) {
          return c.indexOf(cell.car) == 0;
        }), line]);
  };

  module.exports.prototype.argshift = argshift;
}());
