const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const buildDir = path.join(projectRoot, "build");
const pngIconPath = path.join(buildDir, "icon.png");
const icnsIconPath = path.join(buildDir, "icon.icns");

function run(command, args) {
  execFileSync(command, args, {
    stdio: "inherit"
  });
}

function ensureMacIcon() {
  if (fs.existsSync(icnsIconPath) && fs.statSync(icnsIconPath).size > 0) {
    console.log("[FRONDA] build/icon.icns уже готов.");
    return;
  }

  if (!fs.existsSync(pngIconPath)) {
    throw new Error("Не найден build/icon.png. Нечего конвертировать в icon.icns.");
  }

  if (process.platform !== "darwin") {
    console.log("[FRONDA] Подготовка icon.icns пропущена: генерация доступна только на macOS.");
    return;
  }

  const iconsetDir = fs.mkdtempSync(path.join(os.tmpdir(), "fronda-iconset-"));
  const iconsetPath = `${iconsetDir}.iconset`;
  fs.renameSync(iconsetDir, iconsetPath);

  try {
    const outputs = [
      ["icon_16x16.png", 16],
      ["icon_16x16@2x.png", 32],
      ["icon_32x32.png", 32],
      ["icon_32x32@2x.png", 64],
      ["icon_128x128.png", 128],
      ["icon_128x128@2x.png", 256],
      ["icon_256x256.png", 256],
      ["icon_256x256@2x.png", 512],
      ["icon_512x512.png", 512],
      ["icon_512x512@2x.png", 1024]
    ];

    outputs.forEach(([fileName, size]) => {
      run("sips", [
        "-z",
        String(size),
        String(size),
        pngIconPath,
        "--out",
        path.join(iconsetPath, fileName)
      ]);
    });

    run("iconutil", ["-c", "icns", iconsetPath, "-o", icnsIconPath]);
    console.log("[FRONDA] build/icon.icns создан.");
  } finally {
    fs.rmSync(iconsetPath, { recursive: true, force: true });
  }
}

ensureMacIcon();
