
// Wrapper for asm.js modules that we run in workers.

try {

(function(env) {
  console.log("asm.js wrappers setup...");

  env.make_ext4fs = {
    run: (imagePath, folder) => {
      var worker = new ChromeWorker("chrome://b2g-installer/content/worker.js");
      worker.postMessage({ name: "make_ext4fs",
                           url: "make_ext4fs.js",
                           arguments: [imagePath, folder] });

      return new Promise((resolve, reject) => {
        worker.onmessage = e => {
          // Terminate the worker when we are done executing asm.js code.
          if (e.data.done === true) {
            worker.terminate();
            // Actually verify that the image was created.
            let imageFile = new FileUtils.File(imagePath);
            resolve(imageFile.exists());
          } else {
            // TODO: send some progress-like event?
            //console.log(e.data.message);
          }
        }
      });
    }
  }
})(this);

} catch(e) {
  console.error(e);
}