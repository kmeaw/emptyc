var spawn = require('child_process').spawn;
var Q = require('q');
var daemon = null;

module.exports.init = function init(emptyc) {
  if (emptyc.config("autostarter.disable"))
    return Q.resolve();
  return emptyc.napi("/ping").then(function() { return Q.resolve(); }, function() {
    if (!emptyc.config("autostarter.quiet"))
      console.log("autostarter: Daemon ping failed, spawning a new one...");
    daemon = spawn('emptyd', [], { stdio: 'pipe' });
    daemon.stdout.setEncoding('utf-8');
    daemon.stderr.setEncoding('utf-8');
    var buffer = "";
    fill = function(chunk)
    {
      buffer = (buffer + chunk).substr(-4096);
    };
    daemon.stdout.on('data', fill);
    daemon.stderr.on('data', fill);
    daemon.on('close', function(code) {
      if (code !== 0)
        console.error("Daemon exited with code %d.", code);
      daemon = null;
    });
  });
};

module.exports.fini = function fini(emptyc) {
  if (daemon)
  {
    daemon.kill();
    if (!emptyc.config("autostarter.quiet"))
      console.log("Shutting down the daemon...");
  }
  return Q.resolve();
};
