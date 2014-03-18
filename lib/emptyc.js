// vim: ai:ts=2:sw=2:et:syntax=javascript

var Q = require('q');
var http = require('http');
var util = require('util');
var readline = require('readline'), rl;
var sids = {};
var colors = require("colors");
var EventEmitter = require('events').EventEmitter;
var fs = require("fs");
var path = require("path");

var Commands = {
  _init: function() {
    process.title = path.basename(__filename, ".js");
  },

  exit: function() {
    arguments.callee.rl.close();
    return Q.resolve();
  },

  undefined: function() {
    return Q.resolve();
  },

  invalid: function(car) {
    return function(cdr) { return Q.reject("Invalid command: " + car) }
  },

  su: function(car) {
    var prevuser = Config.user;
    Config.user = car || arguments.callee.prevuser || "root";
    arguments.callee.prevuser = prevuser;
    console.log("User has been set to ``%s''.", Config.user);
    return Q.resolve();
  },

  run: function(a, ev) {
    var cell = argshift(a);
    var t = Date.now();
    var aborted = false;

    return Q.resolve(cell.car.split(',')).then(function(keys) {
      return [keys, napi("session/new", JSON.stringify({keys: keys, interactive: !!Config.interactive}))];
    }).spread(function(keys, sid) {
      var sid = sid.id;
      return napi("session/" + sid + "/run", cell.cdr)
        .then(function() {
          var exits = {};
          var failures = {};
          var write_mode = false;
          ev.on("keypress", function(chunk, key) {
            if (write_mode)
            {
              if (chunk == '\u001d')
              {
                console.log("Write mode has been disabled.");
                write_mode = false;
              }
              else
                napi("session/" + sid + "/write", chunk).done();
            }
            else if (key.name == 'q')
            {
              aborted = true;
              napi("session/" + sid, false, "DELETE").done();
            }
            else if (key.name == 's')
            {
              napi("session/" + sid)
                .then(function(s) { console.log(s) })
                .done();
            }
            else if (key.name == 'k')
            {
              napi("session/" + sid)
                .then(function(s) {
                  var k;
                  for(k in s.children)
                    if (s.children[k] == "running" || s.children[k] == "pending")
                      break;
                  console.log("Terminating %s in %s", k, sid);
                  return napi("session/" + sid + "/terminate", k);
                })
                .done();
            }
            else if (key.name == 'w')
            {
              console.log("Entering write mode, escape character is ^].");
              write_mode = true;
            }
          });
          var loop = function()
          {
            return napi("session/" + sid + "/read")
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
                    if (key == null)
                    {
                      console.log("Run took %d ms, %d hosts have failed", 
                          Date.now() - t, 
                          Object.keys(exits).filter(function(k){return exits[k] != 0}).length);
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
                    if (data != 0)
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
      return aborted ? Q.resolve() : napi("session/" + sid, false, "DELETE");
    });
  },

  _prompt: function(car, rl) {
    rl.setPrompt("emptyc> ");
    rl.prompt();
  },

  exit: function() {
    process.stdout.write("\n");
    console.log('Have a great day!');
    process.exit(0);
  },

  _start: function(car, history) {
    rl = readline.createInterface(process.stdin, process.stdout);
    if (history)
      rl.history = history;
    Commands._prompt(null, rl);
    Commands.exit.rl = rl;
    rl.on('line', function(line) {
      rl.removeListener('close', Commands.exit);
      rl.close();
      process.openStdin();
      process.stdin.setRawMode(true);
      var ev = new EventEmitter();
      var keypress = function keypress(chunk, key) {
        ev.emit("keypress", chunk, key);
      };
      process.stdin.on("keypress", keypress);
      var cell = argshift(line);
      var cmd = Commands[cell.car] || Commands.invalid(cell.car);
      cmd(cell.cdr, ev)
        .then(function() { }
      , function(e) { console.error(e) }
        ).fin(function() { 
          process.stdin.removeListener("keypress", keypress); 
          ev.removeAllListeners();
          Commands._start(null, rl.history);
        }).done();
    });
    rl.on('close', Commands.exit);
    rl.on('SIGINT', function() {
      console.log("SIGINT");
    });
  }
};

function napi(path, data, method)
{
  var deferred = Q.defer();

  var options = {
    hostname: Config.server,
    port: Config.server_port,
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
}

function argshift(line)
{
  if (!line)
    return line;
  var line = line.trim();
  var e = /\s/.exec(line);
  if (!e)
    return {'car':line};
  else
    return {'car':line.slice(0, e.index).trim(), 'cdr':line.slice(e.index).trim()};
}

Config = {
  "user": process.env.USER || 'root',
  "interactive": true,
  "server": "::1",
  server_port: 53353,
  plugin_dir: path.join(path.dirname(__filename), "..", "plugins")
};

exports.argshift = argshift;
exports.napi = napi;
exports.Config = Config;
exports.Commands = Commands;

