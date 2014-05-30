var spawn = require('child_process').spawn;
var Q = require('q');
var crypto = require('crypto');
var daemon = null;
var fs = require('fs');
var path = require('path');

var homepath = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
var cookie_path = path.join(homepath, ".empty.cookie");

module.exports.init = function init(emptyc) {
  if (emptyc.config("autostarter.disable"))
    return Q.resolve();
  return emptyc.napi("ping").then(function() { return Q.resolve(); }, function(err) {
    if (err.cookie == "bad" && fs.existsSync(cookie_path))
      emptyc.config("cookie", fs.readFileSync(cookie_path, {encoding:"utf8"}));
  }).then(function() { return emptyc.napi("ping") })
    .then(function() { return Q.resolve(); }, function(err) {
    if (err.cookie == "bad")
      throw new Error('Bad cookie');
    if (!emptyc.config("autostarter.quiet"))
      emptyc.ev.emit("info", "autostarter: Daemon ping failed, spawning a new one...");
    emptyc.config("cookie", crypto.randomBytes(16).toString('hex'));
    var buffer = "";
    if (emptyc.config("autostarter.remote"))
      daemon = spawn('ssh', [emptyc.config("autostarter.remote"),"-L",emptyc.config("server_port")+":localhost:"+emptyc.config("server_port"),"emptyd","--cookie", emptyc.config("cookie")], { stdio: 'pipe' });
    else
      daemon = spawn('emptyd', ["--cookie", emptyc.config("cookie"), "--port", emptyc.config("server_port")], { stdio: 'pipe' });
    var oldmask = process.umask(077);
    fs.writeFileSync(cookie_path, emptyc.config("cookie"));
    process.umask(oldmask);
    daemon.on("error", function(err) {
      emptyc.ev.emit("warn", "autostarter: Daemon start failed: " + err + ", please try running emptyd manually.");
      emptyc.ev.emit("warn", buffer);
    });
    daemon.stdout.setEncoding('utf-8');
    daemon.stderr.setEncoding('utf-8');
    fill = function(chunk)
    {
      buffer = (buffer + chunk).substr(-4096);
    };
    daemon.stdout.on('data', fill);
    daemon.stderr.on('data', fill);
    daemon.on('close', function(code) {
      if (code !== 0)
      {
        emptyc.ev.emit("warn", "Daemon exited with code " + code + ".");
	emptyc.ev.emit("warn", buffer);
      }
      daemon = null;
    });
  });
};

module.exports.fini = function fini(emptyc) {
  if (daemon)
  {
    daemon.kill();
    try {
      fs.unlinkSync(cookie_path);
    } catch(e) {}
    if (!emptyc.config("autostarter.quiet"))
      emptyc.ev.emit("info", "Shutting down the daemon...");
  }
  return Q.resolve();
};
