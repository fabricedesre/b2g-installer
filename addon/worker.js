// Generic chrome worker to run asm.js code.

importScripts("resource://gre/modules/osfile.jsm");

// asm.js module configuration.
// See https://kripken.github.io/emscripten-site/docs/api_reference/module.html

var logTag = "asm.js";

const c = {
  log: args => {
    console.log(logTag + ": " + args);
  },

  error: args => {
    console.error(logTag + ": " + args);
  }
}

// Add our FS implementation.
// See https://kripken.github.io/emscripten-site/docs/api_reference/Filesystem-API.html
// Adapted from the nodefs one at
// https://raw.githubusercontent.com/kripken/emscripten/ba813471568f05c97c59099a963bc35341d4dfb5/src/library_nodefs.js

const FXFS = {
  prefix: "/fx",
  isWindows: false,
  staticInit: function() {
    // TODO: use navigator.something
    FXFS.isWindows = !!process.platform.match(/^win/);
  },
  mount: function(mount) {
    c.log("mount " + JSON.stringify(mount));
    return FXFS.createNode(null, "/", FXFS.getMode(mount.opts.root), 0);
  },
  createNode: function(parent, name, mode, dev) {
    c.log("createNode " + JSON.stringify(arguments));
    if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
      throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
    }
    var node = FS.createNode(parent, name, mode);
    node.node_ops = FXFS.node_ops;
    node.stream_ops = FXFS.stream_ops;
    return node;
  },
  getMode: function (path) {
    c.log("getMode " + path);
    var stat;
    try {
      stat = OS.File.stat(path);
      if (FXFS.isWindows) {
        // On Windows, directories return permission bits 'rw-rw-rw-', even though they have 'rwxrwxrwx', so
        // propagate write bits to execute bits.
        stat.mode = stat.unixMode | ((stat.unixMode & 146) >> 1);
      }
      c.log("stat OK " + stat.unixMode);
    } catch (e) {
      if (!e.code) throw e;
      throw new FS.ErrnoError(ERRNO_CODES[e.code]);
    }
    return stat.unixMode;
  },
  realPath: function (node) {
    c.log("realPath " + node);
    var parts = [];
    while (node.parent !== node) {
      parts.push(node.name);
      node = node.parent;
    }
    parts.push(node.mount.opts.root);
    parts.reverse();
    return PATH.join.apply(null, parts);
  },
  // This maps the integer permission modes from http://linux.die.net/man/3/open
  // to node.js-specific file open permission strings at http://nodejs.org/api/fs.html#fs_fs_open_path_flags_mode_callback
  flagsToPermissionStringMap: {
    0/*O_RDONLY*/: 'r',
    1/*O_WRONLY*/: 'r+',
    2/*O_RDWR*/: 'r+',
    64/*O_CREAT*/: 'r',
    65/*O_WRONLY|O_CREAT*/: 'r+',
    66/*O_RDWR|O_CREAT*/: 'r+',
    129/*O_WRONLY|O_EXCL*/: 'rx+',
    193/*O_WRONLY|O_CREAT|O_EXCL*/: 'rx+',
    514/*O_RDWR|O_TRUNC*/: 'w+',
    577/*O_WRONLY|O_CREAT|O_TRUNC*/: 'w',
    578/*O_CREAT|O_RDWR|O_TRUNC*/: 'w+',
    705/*O_WRONLY|O_CREAT|O_EXCL|O_TRUNC*/: 'wx',
    706/*O_RDWR|O_CREAT|O_EXCL|O_TRUNC*/: 'wx+',
    1024/*O_APPEND*/: 'a',
    1025/*O_WRONLY|O_APPEND*/: 'a',
    1026/*O_RDWR|O_APPEND*/: 'a+',
    1089/*O_WRONLY|O_CREAT|O_APPEND*/: 'a',
    1090/*O_RDWR|O_CREAT|O_APPEND*/: 'a+',
    1153/*O_WRONLY|O_EXCL|O_APPEND*/: 'ax',
    1154/*O_RDWR|O_EXCL|O_APPEND*/: 'ax+',
    1217/*O_WRONLY|O_CREAT|O_EXCL|O_APPEND*/: 'ax',
    1218/*O_RDWR|O_CREAT|O_EXCL|O_APPEND*/: 'ax+',
    4096/*O_RDONLY|O_DSYNC*/: 'rs',
    4098/*O_RDWR|O_DSYNC*/: 'rs+'
  },
  flagsToPermissionString: function(flags) {
    if (flags in FXFS.flagsToPermissionStringMap) {
      return FXFS.flagsToPermissionStringMap[flags];
    } else {
      return flags;
    }
  },
  node_ops: {
    getattr: function(node) {
      c.log("getattr " + node);
      var path = FXFS.realPath(node);
      var stat;
      try {
        stat = fs.lstatSync(path);
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
      // node.js v0.10.20 doesn't report blksize and blocks on Windows. Fake them with default blksize of 4096.
      // See http://support.microsoft.com/kb/140365
      if (FXFS.isWindows && !stat.blksize) {
        stat.blksize = 4096;
      }
      if (FXFS.isWindows && !stat.blocks) {
        stat.blocks = (stat.size+stat.blksize-1)/stat.blksize|0;
      }
      return {
        dev: stat.dev,
        ino: stat.ino,
        mode: stat.mode,
        nlink: stat.nlink,
        uid: stat.uid,
        gid: stat.gid,
        rdev: stat.rdev,
        size: stat.size,
        atime: stat.atime,
        mtime: stat.mtime,
        ctime: stat.ctime,
        blksize: stat.blksize,
        blocks: stat.blocks
      };
    },
    setattr: function(node, attr) {
      c.log("setattr " + node);
      var path = FXFS.realPath(node);
      try {
        if (attr.mode !== undefined) {
          fs.chmodSync(path, attr.mode);
          // update the common node structure mode as well
          node.mode = attr.mode;
        }
        if (attr.timestamp !== undefined) {
          var date = new Date(attr.timestamp);
          fs.utimesSync(path, date, date);
        }
        if (attr.size !== undefined) {
          fs.truncateSync(path, attr.size);
        }
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
    },
    lookup: function (parent, name) {
      c.log("lookup " + arguments);
      var path = PATH.join2(NODEFS.realPath(parent), name);
      var mode = FXFS.getMode(path);
      return FXFS.createNode(parent, name, mode);
    },
    mknod: function (parent, name, mode, dev) {
      c.log("mknod " + arguments);
      var node = FXFS.createNode(parent, name, mode, dev);
      // create the backing node for this in the fs root as well
      var path = FXFS.realPath(node);
      try {
        if (FS.isDir(node.mode)) {
          fs.mkdirSync(path, node.mode);
        } else {
          fs.writeFileSync(path, '', { mode: node.mode });
        }
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
      return node;
    },
    rename: function (oldNode, newDir, newName) {
      c.log("rename " + arguments);
      var oldPath = FXFS.realPath(oldNode);
      var newPath = PATH.join2(NODEFS.realPath(newDir), newName);
      try {
        fs.renameSync(oldPath, newPath);
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
    },
    unlink: function(parent, name) {
      c.log("unlink " + arguments);
      var path = PATH.join2(NODEFS.realPath(parent), name);
      try {
        fs.unlinkSync(path);
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
    },
    rmdir: function(parent, name) {
      c.log("rmdir " + arguments);
      var path = PATH.join2(NODEFS.realPath(parent), name);
      try {
        fs.rmdirSync(path);
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
    },
    readdir: function(node) {
      c.log("readdir " + arguments);
      var path = FXFS.realPath(node);
      try {
        return fs.readdirSync(path);
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
    },
    symlink: function(parent, newName, oldPath) {
      c.log("symlink " + arguments);
      var newPath = PATH.join2(FXFS.realPath(parent), newName);
      try {
        fs.symlinkSync(oldPath, newPath);
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
    },
    readlink: function(node) {
      c.log("readlink " + arguments);
      var path = FXFS.realPath(node);
      try {
        path = fs.readlinkSync(path);
        path = NODEJS_PATH.relative(NODEJS_PATH.resolve(node.mount.opts.root), path);
        return path;
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
    },
  },
  stream_ops: {
    open: function (stream) {
      c.log("open " + arguments);
      var path = FXFS.realPath(stream.node);
      try {
        if (FS.isFile(stream.node.mode)) {
          stream.nfd = fs.openSync(path, FXFS.flagsToPermissionString(stream.flags));
        }
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
    },
    close: function (stream) {
      c.log("close " + arguments);
      try {
        if (FS.isFile(stream.node.mode) && stream.nfd) {
          fs.closeSync(stream.nfd);
        }
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
    },
    read: function (stream, buffer, offset, length, position) {
      c.log("read " + arguments);
      if (length === 0) return 0; // node errors on 0 length reads
      // FIXME this is terrible.
      var nbuffer = new Buffer(length);
      var res;
      try {
        res = fs.readSync(stream.nfd, nbuffer, 0, length, position);
      } catch (e) {
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
      if (res > 0) {
        for (var i = 0; i < res; i++) {
          buffer[offset + i] = nbuffer[i];
        }
      }
      return res;
    },
    write: function (stream, buffer, offset, length, position) {
      c.log("write " + arguments);
      // FIXME this is terrible.
      var nbuffer = new Buffer(buffer.subarray(offset, offset + length));
      var res;
      try {
        res = fs.writeSync(stream.nfd, nbuffer, 0, length, position);
      } catch (e) {
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
      return res;
    },
    llseek: function (stream, offset, whence) {
      c.log("llseek " + arguments);
      var position = offset;
      if (whence === 1) {  // SEEK_CUR.
        position += stream.position;
      } else if (whence === 2) {  // SEEK_END.
        if (FS.isFile(stream.node.mode)) {
          try {
            var stat = fs.fstatSync(stream.nfd);
            position += stat.size;
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        }
      }

      if (position < 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      return position;
    }
  }
}

// Runtime module configuration.

function populateIDB() {
  var folder = Module.arguments[0];
  c.log("Populating indexedDB from " + folder);
}

var Module = {
  print: c.log,
  error: c.error,
  setStatus: msg => {
    postMessage({ done: false, message: msg });
    c.log
  },

  preInit: () => {
    c.log("preInit");
    // Unmount the default memory filesystem and hook up our own.
    try {
      FS.mkdir(FXFS.prefix);
      FS.mount(FXFS, { root: "/" }, FXFS.prefix);
      populateIDB();
    } catch(e) {
      c.error(e);
    }
  },

  preRun: () => {
    c.log("preRun");
  },

  locateFile: url => {
    c.log("locateFile " + url);
    return url;
  },

  logReadFiles: true
}

onmessage = e => {
  var data = e.data;
  console.log("worker message: " + JSON.stringify(data));
  logTag = data.name;
  var args = data.arguments;
  Module.arguments = [ FXFS.prefix + args[0], FXFS.prefix + args[1] ];
  importScripts(data.url);
  c.log("Done with " + data.url);
  postMessage({ done: true, result: true });
}
