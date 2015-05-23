/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/FileUtils.jsm');
Cu.import("resource://gre/modules/ZipUtils.jsm");

const { Devices } = Cu.import("resource://gre/modules/devtools/Devices.jsm");
const { OS } = Cu.import("resource://gre/modules/osfile.jsm", {});

let global = this;

try {
  Services.scriptloader
          .loadSubScript("chrome://b2g-installer/content/wrappers.js", global);
} catch(e) {
  console.error(e);
}

const kBlobFree       = "blobfree.zip";
const kBlobsInject    = "blobs-toinject.txt";
const kCmdlineFs      = "cmdline-fs.txt";
const kDeviceRecovery = "recovery.fstab";
const kDevicesJson    = "devices.json";

const kContent     = "content";
const kBlobs       = "blobs";
const kImages      = "images";

const kExpectedBlobFreeContent = [
  kBlobFree, kBlobsInject, kCmdlineFs, kDevicesJson, kDeviceRecovery
];

const kB2GInstallerTmp = FileUtils.getDir("TmpD", ["b2g-installer"], true).path;

let supportedDevices = [];

function getBlobs(device, root, map) {
  console.debug("Pulling blobs ...");
  if (!device || !device.type === "adb") {
    console.error("Device", device, "is not valid");
    return Promise.reject("notready");
  }

  updateProgressValue(0, 1, "Preparing to get blobs from device");

  let blobsDir = new FileUtils.File(OS.Path.join(root, kBlobs));
  if (!blobsDir.exists()) {
    blobsDir.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt('0700', 8));
  }

  let list = [];
  map.forEach(line => {
    if (line.indexOf(":") === -1) {
      return;
    }

    let [ src, tgt ] = line.split(":");
    if (!src || !tgt) {
      console.debug("Invalid source", src, "or target", tgt, "for", line);
      return;
    }

    // Element already in list
    if (list.indexOf(src) !== -1) {
      return;
    }

    // Remove leading / for OS.Path.join()
    let _src = src[0] === "/" ? src.slice(1) : src;

    let f = new FileUtils.File(OS.Path.join(blobsDir.path, _src));
    let p = f.parent;
    if (!p.exists()) {
      p.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt('0700', 8));
    }

    if (!f.exists()) {
      list.push(src);
    }
  });

  return new Promise((resolve, reject) => {
    device.isRoot().then(isRoot => {
      if (!isRoot) {
        console.error("Not root, should not happen.");
      } else {
        console.debug("Ready to pull blobs from device.");
      }

      let currentBlob = 0;
      let pullNextBlob = function(cb) {
        if (currentBlob >= list.length) {
          cb && cb();
          return;
        }

        let src = list[currentBlob];
        if (!src) {
          console.error("Invalid", src, "at", currentBlob);
          return;
        }

        updateProgressValue(currentBlob, list.length, src);

        // Remove leading / for OS.Path.join()
        let _src = src[0] === "/" ? src.slice(1) : src;
        let f = new FileUtils.File(OS.Path.join(blobsDir.path, _src));
        currentBlob++;

        device.pull(src, f.path).then(res => {
          console.log("adb pull", src, f.path, "success", res);
          pullNextBlob(cb);
        }).catch(reason => {
          console.log("adb pull", src, f.path, "fail", reason);
          pullNextBlob(cb);
        });
      };

      updateProgressValue(0, 1, "Starting to pull blobs from device.");
      pullNextBlob(function() {
        updateProgressValue(0, 1, "All blobs have been pulled.");
        resolve();
      });
    });
  });
}

function buildRamdisk(from, to) {
  let ramdiskDir = new FileUtils.File(OS.Path.join(from, "RAMDISK"));
  if (!ramdiskDir.exists() || !ramdiskDir.isDirectory()) {
    return Promise.reject();
  }

  console.debug("Building ramdisk", from, to);

  /*
  let mkbootfsBin = "/home/alex/codaz/Mozilla/b2g/devices/B2GInjector/mkbootfs";
  let cpioContent;
  subprocess.call({
    command: mkbootfsBin,
    arguments: [ ramdiskDir.path ],
    stdout: function(cpio) {
      cpioContent += cpio;
    },
    done: function() {
      OS.File.writeAtomic(new File(to), cpioContent, "").then(
        function onSuccess() {
          console.debug("Written cpio to", to);
          deferred.resolve(true);
        },
        function onFailure() {
          console.debug("Unable to write cpio to", to);
          deferred.resolve(false);
        }
      );
    }
  });
  */

  return new Promise((resolve, reject) => {
    setTimeout(function() {
      resolve(true);
    }, 3000);
  });
}

function buildBootable(root, to) {
  console.debug("Building bootable image", root, to);

  /**
  pushd "${IMAGE_DIR}/${src}";
    ../../mkbootimg \
      --kernel "kernel" \
      --ramdisk "initrd.img" \
      --cmdline "`cat cmdline`" \
      --pagesize "`cat pagesize`" \
      --base "`cat base`" \
      --dt "../../dt.img" \
      --output "../../${img}"
  **/

  let readFiles = [];
  let filesToRead = [ "cmdline", "pagesize", "base" ];
  filesToRead.forEach(file => {
    readFiles.push(OS.File.read(OS.Path.join(root, file), { encoding: "utf-8" }));
  });

  // it's in device/, not in device/content/(BOOT|RECOVERY)/
  let hasDeviceTree = new FileUtils.File(OS.Path.join(root, "..", "..", "dt.img")).exists();
  console.debug("This device hasDeviceTree? ", hasDeviceTree);

  return new Promise((resolve, reject) => {
    Promise.all(readFiles).then(results => {
      console.debug("Read all files");
      for (let i = 0; i < results.length; i++) {
        let filename = filesToRead[i];
        console.debug("Content of", filename, results[i]);
      };
      resolve(true);
    });
  });
}

function buildBootImg(fstab) {
  let fstabPart = fstab["boot.img"];
  return new Promise((resolve, reject) => {
    buildRamdisk(fstabPart.sourceDir, OS.Path.join(fstabPart.sourceDir, "initrd.img")).then(result => {
      console.debug("Boot.img ramdisk built", result);

      buildBootable(fstabPart.sourceDir, fstabPart.imageFile).then(result => {
        console.debug("Built everything", result);
        resolve(true);
      });
    });
  });
}

function buildRecoveryImg(fstab) {
  let fstabPart = fstab["recovery.img"];
  return new Promise((resolve, reject) => {
    buildRamdisk(fstabPart.sourceDir, OS.Path.join(fstabPart.sourceDir, "initrd.img")).then(result => {
      console.debug("Recovery.img ramdisk built", result);

      buildBootable(fstabPart.sourceDir, fstabPart.imageFile).then(result => {
        console.debug("Built everything", result);
        resolve(true);
      });
    });
  });
}

function buildSystemImg(fstab) {
  let fstabPart = fstab["system.img"];
  console.debug("Will build system.img from", fstabPart.sourceDir, "to", fstabPart.imageFile);
  // Hook up make_ext4fs.js
  return make_ext4fs.run(fstabPart.imageFile, fstabPart.sourceDir);
}

function injectBlobs(root, map) {
  let list = [];

  map.forEach(line => {
    if (line.indexOf(":") === -1) {
      console.debug("Not a map line", line);
      return;
    }

    let [ src, tgt ] = line.split(":");
    if (!src || !tgt) {
      console.debug("Invalid source", src, "or target", tgt, "for", line);
      return;
    }

    // Remove leading / for OS.Path.join()
    let _src = src[0] === "/" ? src.slice(1) : src;
    let _tgt = tgt[0] === "/" ? tgt.slice(1) : tgt;

    let fileSrc = new FileUtils.File(OS.Path.join(root, kBlobs, _src));
    let fileTgt = new FileUtils.File(OS.Path.join(root, kContent, _tgt));

    if (!fileTgt.exists()) {
      console.debug("Copying", fileSrc.path, "to", fileTgt.path);
      try {
        fileSrc.copyTo(fileTgt.parent, fileTgt.leafName);
        list.push(tgt);
      } catch (ex) {
        console.error(fileSrc, fileTgt, ex);
        return;
      }
    }
  });

  return Promise.resolve(list);
}

function readBlobsMap(root) {
  return new Promise((resolve, reject) => {
    let fr = new FileReader();
    let blobs = new File(OS.Path.join(root, kBlobsInject));
    fr.readAsText(blobs);
    console.debug("Reading blobs map from", blobs);
    fr.addEventListener("loadend", function() {
      console.debug("Blobs map:", fr.result.split("\n"));
      resolve(fr.result.split("\n"));
    });
  });
}

function readRecoveryFstab(root) {
  return new Promise((resolve, reject) => {
    let fr = new FileReader();
    let fstab = new File(OS.Path.join(root, kDeviceRecovery));
    fr.readAsText(fstab);
    console.debug("Reading fstab rom", fstab);
    fr.addEventListener("loadend", function() {
      let content = fr.result.split("\n");
      console.debug("Recovery fstab:", content);
      // deferred.resolve(fr.result.split("\n"));

      let finalFstab = {};
      content.forEach(line => {
        line = line.trim();

        if (!line.startsWith("/dev")) {
          return;
        }

        // device is 0, mount point is 1
        let parts = line.split(" ").filter(function(e) {
          return (e !== "");
        });

        let mountPoint   = parts[1].slice(1);
        let fastbootPart = parts[0].split("/").slice(-1)[0];
        let fastbootImg  = mountPoint + ".img";

        let contentDir = new FileUtils.File(OS.Path.join(root, kContent, mountPoint.toUpperCase()));
        if (!contentDir.exists() || !contentDir.isDirectory()) {
          console.debug("No", contentDir.path);
          return;
        }

        finalFstab[fastbootImg] = {
          "sourceDir": contentDir.path,
          "imageFile": OS.Path.join(root, kImages, fastbootImg),
          "partition": fastbootPart
        };
      });

      console.debug("Will use", finalFstab);
      resolve(finalFstab);
    });
  });
}

function dealWithBlobFree(obj) {
  console.log("Extracting blob free distribution:", obj.files[0]);
  let blobfreeZipPromise = extractBlobFreeDistribution(obj.files[0]);
  blobfreeZipPromise.then(root => {
    console.log("Extracting blob free content:", root);
    // Main zip file extracted, extract image content
    extractBlobFreeContent(root).then(result => {
      if (!result) {
        console.error("Error extracting content");
        return;
      }

      console.log("Blob free distribution extracted.");
      readBlobsMap(root).then(map => {
        console.log("Blob map extracted, getting fstab");

        readRecoveryFstab(root).then(fstab => {
          console.log("Recovery fstab read", fstab , ", enumerating devices");

          getAllDevices().then(device => {
            console.log("Devices enumerated, pulling all blobs for", device);

            getBlobs(device, root, map).then(() => {
              console.log("Got blobs map", map, "injecting them");

              injectBlobs(root, map).then(injected => {
                console.log("Injected blobs", injected);

                let toBuild = [
                  buildBootImg(fstab),
                  buildRecoveryImg(fstab),
                  buildSystemImg(fstab)
                ];

                Promise.all(toBuild).then(results => {
                  console.debug("All pending builds finished:", results);
                });
              });
            })
          });
        });
      });
    });
  });
}

function extractBlobFreeDistribution(zip) {
  console.debug("Dealing with", zip);

  // We expect file name to be like: PRODUCT_DEVICE.XXX.zip
  let fullPath = zip.mozFullPath;
  let productDevice = zip.name.split(".")[0];
  let devicePath = OS.Path.join(kB2GInstallerTmp, productDevice);

  let zipFile = new FileUtils.File(fullPath);
  let targetDir = new FileUtils.File(devicePath);

  if (!targetDir.exists()) {
     targetDir.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt('0700', 8));
  } else {
     if (!targetDir.isDirectory()) {
       console.error("Target directory exists but is not a directory.");
       return Promise.reject();
     }
  }

  return new Promise((resolve, reject) => {
    ZipUtils.extractFilesAsync(zipFile, targetDir).then(result => {
      console.debug("Extracted", zipFile, "to", targetDir, "result=", result);
      for (let f of kExpectedBlobFreeContent) {
        let fi = new FileUtils.File(OS.Path.join(devicePath, f));
        console.debug("Checking existence of", f);
        if (!fi.exists()) {
          console.error("Missing", f);
           reject();
        }
      }

      let fr = new FileReader();
      let devices = new File(OS.Path.join(devicePath, kDevicesJson));
      fr.readAsText(devices);
      console.debug("Reading content of", devices);
      fr.addEventListener("loadend", function() {
        supportedDevices = JSON.parse(fr.result);
        console.debug("Content of devices:", supportedDevices);
        resolve(devicePath);
      });
    });
  });
}

function extractBlobFreeContent(devicePath) {
  let zipFile = new FileUtils.File(OS.Path.join(devicePath, kBlobFree));
  let targetDir = new FileUtils.File(OS.Path.join(devicePath, kContent));

  if (!targetDir.exists()) {
     targetDir.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt('0700', 8));
  } else {
     if (!targetDir.isDirectory()) {
       console.error("Target directory exists but is not a directory.");
       return Promise.reject();
     }
  }

  console.debug("Running ZipUtils.extractFiles");
  ZipUtils.extractFiles(zipFile, targetDir);
  console.debug("ZipUtils.extractFiles: success");

  return Promise.resolve(true);
}

function updateProgressValue(current, max, blobName) {
  let prcent  = ((current * 1.0) / max) * 100;
  document.getElementById("blobs-pulled").value = prcent;
  document.getElementById("current-blob").textContent = blobName;
}

function addNode(p, id, content) {
  let node = document.createElement('li');
  node.id = id;
  node.textContent = content || id;
  p.appendChild(node);
  return node;
}

function delNode(id) {
  let node = document.getElementById(id);
  if (!node) {
    return;
  }

  node.parentNode.removeChild(node);
}

function addAdbNode(id, name, cb) {
  let adbRoot = document.getElementById('adb-devices');
  let adbNode = addNode(adbRoot, id, name);
  let adbBtn  = document.createElement('button');
  adbBtn.textContent = 'Reboot to bootloader';
  adbBtn.addEventListener('click', cb);
  adbNode.appendChild(adbBtn);
}

function delAdbNode(id) {
  delNode(id);
}

function addFastbootNode(id, product, cb) {
  let fastbootRoot = document.getElementById('fastboot-devices');
  let fastbootNode = addNode(fastbootRoot, id, product);
  let fastbootBtn  = document.createElement('button');
  fastbootBtn.textContent = 'Reboot to system';
  fastbootBtn.addEventListener('click', cb);
  fastbootNode.appendChild(fastbootBtn);
}

function delFastbootNode(id) {
  delNode(id);
}

function inAdbMode(device) {
  delFastbootNode(device.id);
  console.debug("Device is in ADB mode.");

  device.isRoot().then(isRoot => {
    if (!isRoot) {
      console.debug("Putting device into root mode.");
      device.summonRoot().then(() => {
        console.debug("Device should be in root mode now.");
        getAllDevices();
      });
    } else {
      device.getModel().then(model => {
        addAdbNode(device.id, device.id + "/" + model, function() {
          delAdbNode(device.id);
          Devices.emit("fastboot-start-polling");
          device.reboot_bootloader().then(() => {
            console.debug("Device should be in fastboot mode now.");
          });
        });
      });
    }
  });
}

function inFastbootMode(device) {
  delAdbNode(device.id);
  console.debug("Device is in Fastboot mode.");
  device.getvar("product", device.id).then(product => {
    device.getvar("serialno", device.id).then(sn => {
      addFastbootNode(device.id, product + "/" + sn, function() {
        delFastbootNode(device.id);
        device.reboot(device.id).then(() => {
          console.debug("Device should be in normal mode now.");
          Devices.emit("fastboot-stop-polling");
        });
      });
    });
  });
}

function isSupportedDevice(device) {
  return new Promise((resolve, reject) => {
    // Get all ADB fields and check their values
    if (device.type === "adb") {
      let allAdbFields = {};
      device.shell("getprop").then(props => {
        for (let _line of props.split("\n")) {
          let line = _line.trim();
          if (line.length === 0) {
            continue;
          }

          let [ key, value ] = line.split(": ");
          if (key.slice(0, 1) === "[" && key.slice(-1) === "]") {
            key = key.slice(1, -1);
            if (value.slice(0, 1) === "[" && value.slice(-1) === "]") {
              value = value.slice(1, -1);
              allAdbFields[key] = value;
            }
          }
        }

        let deviceOk = false;
        for (let supportedDevice of supportedDevices) {

          let anyPropNotGood = false;
          for (let prop in supportedDevice.adb) {
            let values = supportedDevice.adb[prop];

            let propVal = allAdbFields[prop];
            let isOk = (typeof values === "object") ? (values.indexOf(propVal) !== -1) : (values === propVal);

            if (!isOk) {
              anyPropNotGood = true;
              break;
            }
          }

          if (!anyPropNotGood) {
            deviceOk = true;
            resolve(supportedDevice);
            break;
          }
        }

        if (!deviceOk) {
          reject();
        }
      });
    }

    // For fastboot, we query one by one
    if (device.type === "fastboot") {
      for (let supportedDevice of supportedDevices) {
        let getValues = [];

        for (let varname in supportedDevice.fastboot) {
          let values = supportedDevice.fastboot[varname];
          (function(name, expected) {
            let getValuePromise = device.getvar(name, device.id).then(function onSuccess(varVal) {
              let isOk = (typeof expected === "object") ? (expected.indexOf(varVal) !== -1) : (expected === varVal);
              return isOk;
            });
            getValues.push(getValuePromise);
          })(varname, values);
        }

        Promise.all(getValues).then(values => {
          if (values.indexOf(false) === -1) {
            resolve(supportedDevice);
          }
        })
      }
    }
  });
}

function getAllDevices() {
  return new Promise((resolve, reject) => {
    let devices = Devices.available();
    for (let d in devices) {
      let name = devices[d];
      let device = Devices._devices[name];

      isSupportedDevice(device).then(() => {
        if (device.type === "adb") {
          inAdbMode(device);
        }

        if (device.type === "fastboot") {
          inFastbootMode(device);
        }

        resolve(device);
      }, () => {
        console.error("Device", device, "is not yet supported.");
        reject(device);
      });
    }
  });
}

addEventListener("load", function load() {
  removeEventListener("load", load, false);

  getAllDevices();

  Devices.on("register", getAllDevices);
  Devices.on("unregister", getAllDevices);

  let blobsFreeImage = document.getElementById('blobfree');
  blobsFreeImage.addEventListener('change', dealWithBlobFree.bind(null, blobsFreeImage));
}, false);

/* vim: set et ts=2 sw=2 : */
