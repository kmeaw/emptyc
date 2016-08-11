var util = require("util");
var Q = require('q');
var tty = require("tty");
var fs = require('fs');
var readline = require('readline');
var path = require('path');
var EventEmitter = require('events').EventEmitter;
var child_process = require("child_process");
var homepath = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
var pipe;

module.exports.init = function init(emptyc) {
  if (process.platform != 'linux') return Q.resolve();
  var ffi = require("ffi");
  var ref = require('ref');
  var ArrayType = require("ref-array");
  var libreadline = ffi.Library('libreadline', {
    add_history: [ 'void', [ 'string' ] ],
    readline: [ 'string', [ 'string' ] ],
    using_history: [ 'void', [] ],
    rl_set_prompt: [ 'int', [ 'string' ] ],
    rl_callback_read_char: [ 'void', [] ],
    rl_stuff_char: [ 'int', [ 'int' ] ],
    rl_callback_handler_install: [ 'void', [ 'string', 'pointer' ] ],
    rl_forced_update_display: [ 'int', [] ],
    rl_callback_handler_remove: [ 'void', [] ],
  });
  var libc = ffi.Library('libc', {
    strdup: [ 'void*', [ 'string' ] ],
    malloc: [ 'void*', [ 'int' ] ],
    memcpy: [ 'void', [ 'void*', 'void*', 'int' ] ],
  //  abort: [ 'void', [ 'void*' ] ],
    pipe: [ 'int', [ ref.refType('int') ] ],
    write: [ 'int', [ 'int', 'char*', 'int' ] ],
    read: [ 'int', [ 'int', 'char*', 'int' ] ],
  });
  var libreadline_so = ffi.DynamicLibrary('libreadline.so');
  var rl_attempted_completion_function = libreadline_so.get('rl_attempted_completion_function');
  var rl_line_buffer = libreadline_so.get('rl_line_buffer');
  var saved_prompt = ">";
  var initialized = false;
  libreadline.using_history();
  readline.createInterface = function(opts) {
    var rl = new EventEmitter();
    var stuffer = function(data) {
      var bytes = new Buffer(data);
      bytes.forEach(function(b) {
        if (b == 4)
        {
          rl.emit("close");
          return false;
        }
        if (!libreadline.rl_stuff_char (b))
          throw 'libreadline: buffer overflow';
        libreadline.rl_callback_read_char ();
      }); 
    };
    pipe = new Buffer(8); // [ -1, -1 ];
    libc.pipe(pipe);
    pipe = [ref.get(pipe, 0, ref.types.int), ref.get(pipe, ref.types.int.size, ref.types.int)];
    var buffer = new Buffer(4096);

    function completer(text, start, end) {
      //opts.completer(text, (results) => fs.writeFileSync(pipe[1], JSON.stringify(results) + "\n"));
      var rl_line_buffer = libreadline_so.get('rl_line_buffer');
      text = rl_line_buffer.readPointer().readCString();
      opts.completer(text, function(err, results) {
        var j = new Buffer(JSON.stringify(results) + "\n");
        libc.write(pipe[1], j, Buffer.byteLength(j));
      });
      var bytes = libc.read(pipe[0], buffer, buffer.length);
      if (bytes >= 0)
        buffer.writeUInt8(0, bytes);
      try {
        var result = JSON.parse(ref.readCString(buffer, 0));
        result = result[0].map((s) => s.substring(start)).filter((s) => s.trim().length);
      } catch(e) {
        console.log("Cannot read JSON at " + ref.readCString(buffer, 0) + " / " + util.inspect(ref.readCString(buffer,0)));
        console.log(e);
      }
      if (result === null) result = [];
      if (result.length != 1)
        result.unshift(text.substring(start));
      var out = ref.alloc(ArrayType('string', result.length + 1));
      var cstr = result.map((s) => ref.allocCString(s));
      cstr = cstr.map((s) => libc.strdup(s));
      for(var i = 0; i < result.length; i++)
        ref._writePointer(out, i * ref.sizeof.pointer, cstr[i]);
      ref.writePointer(out, result.length * ref.sizeof.pointer, ref.NULL_POINTER.deref());
      var mem = libc.malloc(out.length);
      libc.memcpy(mem, out, out.length);
      //libc.abort(mem);
      return mem;
    }
    var cb = ffi.Callback(ref.refType('string'), ['string', 'int', 'int'], completer);
    rl_attempted_completion_function.writePointer(cb);
    var line_handler = ffi.Callback('void', ['string'], function(line) {
      if (line === null || line == "") return;
      opts.input.removeListener("data", stuffer);
      libreadline.rl_callback_handler_remove();
      process.stdin.setRawMode(true);
      libreadline.add_history(line);
      emptyc.rl.emit("line", line);
    });
    process.on('exit', function() { /* Avoid being GC'd */
      cb;
      line_handler;
    });

    rl.setPrompt = function(prompt, stripped_prompt) {
      saved_prompt = prompt.replace(/\x1B\[\d+m/g, "\x01$&\x02");
      process.stdin.setRawMode(false);
      libreadline.rl_set_prompt(saved_prompt);
    };
    rl._refreshLine = function() {
      this.prompt();
    };
  //  rl._refreshLine = () => true,
    rl.prompt = function() {
      if (!initialized)
      {
        initialized = true;
        rl.history.reverse().forEach((s) => libreadline.add_history(s));
      }

      opts.output.write("\x1B[K\r\n");
      libreadline.rl_callback_handler_install(saved_prompt, line_handler);
      opts.input.on("data", stuffer);
    };
    rl.history = [];
    return rl;
  };
  return Q.resolve();
};

module.exports.fini = function fini(emptyc) {
  if (pipe)
  {
    fs.closeSync(pipe[0]);
    fs.closeSync(pipe[1]);
  }
  return Q.resolve();
};
