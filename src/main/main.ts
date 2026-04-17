import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AppCommand } from "@shared/types";
import { registerIpcHandlers } from "./ipc";
import { FrondaAppService } from "./services/app-service";

let mainWindow: BrowserWindow | null = null;
let displayMetricsListenerRegistered = false;
let allowMainWindowClose = false;
let closeNoticeInProgress = false;
let ipcRegistered = false;

const ENTRY_NOTICE_TEXT =
  "Ребята, я захожу в программу реестра фронды, пожалуйста, не заходите пока не отпишусь.";
const EXIT_NOTICE_TEXT = "Ребят, я завершил(а) редактирование реестра, прога свободна.";
const isDev = !app.isPackaged;
const appService = new FrondaAppService();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeAdaptiveZoom(window: BrowserWindow): number {
  const display = screen.getDisplayMatching(window.getBounds());
  const physicalWidth = display.size.width;
  const physicalHeight = display.size.height;

  if (physicalWidth < 3840 && physicalHeight < 2160) {
    return 1;
  }

  const logicalWidth = display.workAreaSize.width;
  const logicalHeight = display.workAreaSize.height;
  const fitRatio = Math.min(logicalWidth / 1920, logicalHeight / 1080);
  return Number(clamp(fitRatio * 0.96, 0.72, 1).toFixed(2));
}

function applyAdaptiveZoom(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  const nextZoom = computeAdaptiveZoom(window);
  if (Math.abs(window.webContents.getZoomFactor() - nextZoom) < 0.01) {
    return;
  }
  window.webContents.setZoomFactor(nextZoom);
}

function handleDisplayMetricsChanged(): void {
  if (mainWindow) {
    applyAdaptiveZoom(mainWindow);
  }
}

function resolveWindowIcon(): string | undefined {
  const executableDir = path.dirname(app.getPath("exe"));
  const prefersIco = process.platform === "win32";
  const devCandidates = prefersIco
    ? [path.join(process.cwd(), "build", "icon.ico"), path.join(process.cwd(), "build", "icon.png")]
    : [path.join(process.cwd(), "build", "icon.png"), path.join(process.cwd(), "build", "icon.ico")];
  const packagedCandidates = prefersIco
    ? [
        path.join(executableDir, "icon.ico"),
        path.join(executableDir, "icon.png"),
        path.join(process.resourcesPath, "icon.ico"),
        path.join(process.resourcesPath, "icon.png")
      ]
    : [
        path.join(executableDir, "icon.png"),
        path.join(executableDir, "icon.ico"),
        path.join(process.resourcesPath, "icon.png"),
        path.join(process.resourcesPath, "icon.ico")
      ];
  const candidates = isDev ? devCandidates : packagedCandidates;
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function sendAppCommand(command: AppCommand): void {
  mainWindow?.webContents.send("app:command", command);
}

function buildApplicationMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "Файл",
      submenu: [
        {
          label: "Сменить рабочую папку...",
          accelerator: "Ctrl+Shift+O",
          click: () => sendAppCommand({ type: "workspace:change" })
        },
        {
          label: "Обновить локальную копию",
          accelerator: "F5",
          click: () => sendAppCommand({ type: "workspace:refresh" })
        },
        { type: "separator" },
        { label: "Выход", role: "quit" }
      ]
    },
    {
      label: "Правка",
      submenu: [
        { label: "Отменить", role: "undo" },
        { label: "Повторить", role: "redo" },
        { type: "separator" },
        { label: "Вырезать", role: "cut" },
        { label: "Копировать", role: "copy" },
        { label: "Вставить", role: "paste" },
        { label: "Выделить все", role: "selectAll" }
      ]
    },
    {
      label: "Вид",
      submenu: [
        { label: "Главная", click: () => sendAppCommand({ type: "navigate", section: "dashboard" }) },
        { label: "Структура", click: () => sendAppCommand({ type: "navigate", section: "structure" }) },
        { label: "Состав", click: () => sendAppCommand({ type: "navigate", section: "composition" }) },
        { label: "Релизы", click: () => sendAppCommand({ type: "navigate", section: "releases" }) },
        { label: "Импорт", click: () => sendAppCommand({ type: "navigate", section: "imports" }) },
        { label: "Справочники", click: () => sendAppCommand({ type: "navigate", section: "directories" }) },
        { label: "Статистика", click: () => sendAppCommand({ type: "navigate", section: "statistics" }) },
        { label: "Система", click: () => sendAppCommand({ type: "navigate", section: "system" }) },
        { type: "separator" },
        {
          label: "Расширенный режим",
          accelerator: "Ctrl+Shift+D",
          click: () => sendAppCommand({ type: "view:toggleAdvanced" })
        },
        { type: "separator" },
        { label: "Во весь экран", role: "togglefullscreen" }
      ]
    },
    {
      label: "Настройки",
      submenu: [
        {
          label: "Сменить рабочую папку...",
          click: () => sendAppCommand({ type: "workspace:change" })
        },
        {
          label: "Открыть папку настроек",
          click: () => sendAppCommand({ type: "settings:openFolder" })
        }
      ]
    },
    {
      label: "Справка",
      submenu: [
        {
          label: "О FRONDA",
          click: () => {
            if (!mainWindow) return;
            void dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "О FRONDA",
              message: "FRONDA",
              detail: "Внутреннее рабочее приложение реестра фронды."
            });
          }
        }
      ]
    }
  ]);
}

async function createWindow(): Promise<void> {
  nativeTheme.themeSource = "dark";
  allowMainWindowClose = false;
  closeNoticeInProgress = false;

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1240,
    minHeight: 760,
    backgroundColor: "#080809",
    title: "FRONDA",
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await mainWindow.loadURL("http://localhost:5173");
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  mainWindow.webContents.once("did-finish-load", () => {
    if (!mainWindow) return;
    applyAdaptiveZoom(mainWindow);
    sendAppCommand({
      type: "notice:show",
      notice: "entry",
      title: "Перед началом работы",
      message: "НАПИШИ В ЧАТ, ЧТО ОТКРЫЛ(А) РЕЕСТР И ЗАНИМАЕШЬСЯ РЕДАКТИРОВАНИЕМ.",
      copyText: ENTRY_NOTICE_TEXT
    });
  });

  const updateZoom = () => {
    if (mainWindow) {
      applyAdaptiveZoom(mainWindow);
    }
  };

  mainWindow.on("resize", updateZoom);
  mainWindow.on("move", updateZoom);
  mainWindow.on("close", (event) => {
    if (allowMainWindowClose || closeNoticeInProgress) {
      return;
    }
    event.preventDefault();
    closeNoticeInProgress = true;
    sendAppCommand({
      type: "notice:show",
      notice: "exit",
      title: "Перед закрытием",
      message: "НАПИШИ В ЧАТ, ЧТО ЗАВЕРШИЛ(А) РЕДАКТИРОВАНИЕ И ЗАКРЫВАЕШЬ ПРОГРАММУ.",
      copyText: EXIT_NOTICE_TEXT
    });
  });

  if (!displayMetricsListenerRegistered) {
    screen.on("display-metrics-changed", handleDisplayMetricsChanged);
    displayMetricsListenerRegistered = true;
  }

  Menu.setApplicationMenu(buildApplicationMenu());
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("studio.fronda.desktop");
  }

  if (!ipcRegistered) {
    registerIpcHandlers(appService);
    ipcMain.handle("app:continueClose", async (_event, userName?: string) => {
      closeNoticeInProgress = false;
      try {
        await appService.finalizeWorkspaceOnExit(userName ?? "Портативный пользователь");
      } catch (error) {
        console.error("Не удалось завершить финальную синхронизацию перед закрытием", error);
      }
      allowMainWindowClose = true;
      mainWindow?.close();
      return true;
    });
    ipcRegistered = true;
  }

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
