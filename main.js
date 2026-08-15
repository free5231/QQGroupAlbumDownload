const { app, BrowserWindow, dialog } = require("electron");
const { setCookies, setTk, setQQ } = require("./qqCore");
require("./ipcMain.js");
const path = require("node:path");

let loginWindow;
let mainWindow;
let loginSuccessHandled = false;

const mainURL =
  process.env.NODE_ENV === "development"
    ? "http://localhost:8080"
    : `./web/index.html`;

const QQURL =
  "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?proxy_url=https%3A//qzs.qq.com/qzone/v6/portal/proxy.html&daid=5&&hide_title_bar=1&low_login=0&qlogin_auto_login=1&no_verifyimg=1&link_target=blank&appid=549000912&style=22&target=self&s_url=https%3A%2F%2Fqzs.qq.com%2Fqzone%2Fv5%2Floginsucc.html%3Fpara%3Dizone&pt_qr_app=%E6%89%8B%E6%9C%BAQQ%E7%A9%BA%E9%97%B4&pt_qr_link=https%3A//z.qzone.com/download.html&self_regurl=https%3A//qzs.qq.com/qzone/v6/reg/index.html&pt_qr_help_link=https%3A//z.qzone.com/download.html&pt_no_auth=0";

function generateTK(str) {
  let hash = 5381;
  for (let i = 0, len = str.length; i < len; i++) {
    hash += (hash << 5) + str.charCodeAt(i);
  }
  return hash & 0x7fffffff;
}

function handleLoginSuccess() {
  if (loginSuccessHandled) return;
  if (!loginWindow || loginWindow.isDestroyed()) return;
  loginSuccessHandled = true;

  loginWindow.webContents.session.cookies
    .get({ url: "https://user.qzone.qq.com" })
    .then((cookies) => {
      setCookies(
        cookies
          .map((cookie) => {
            if (cookie.name == "p_skey") {
              setTk(generateTK(cookie.value));
            }
            if (cookie.name == "p_uin") {
              setQQ(cookie.value.match(/[1-9][0-9]*/g));
            }
            return `${cookie.name}=${cookie.value}`;
          })
          .join("; ")
      );

      dialog
        .showMessageBox(loginWindow, {
          type: "info",
          title: "信息",
          message: "登陆成功！",
          buttons: ["OK"],
        })
        .then(() => {
          if (!loginWindow || loginWindow.isDestroyed()) return;
          createMainWindow();
          loginWindow.destroy();
        });
    });
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return;
  mainWindow = new BrowserWindow({
    height: 600,
    useContentSize: true,
    width: 800,
    title: "控制中心",
    autoHideMenuBar: true,
    webPreferences: {
      devTools: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL(mainURL);
  } else {
    mainWindow.loadFile(mainURL);
  }


  mainWindow.on("closed", function () {
    loginWindow = null;
  });
}

function createWindow() {
  loginWindow = new BrowserWindow({
    height: 500,
    useContentSize: true,
    width: 400,
    title: "登录QQ账号",
    autoHideMenuBar: true,
    webPreferences: {
      devTools: true,
    },
  });

  // 根因修复：通过会话 Cookie 变更判定登录成功，避免依赖中转页 URL 加载
  const cookieState = {};
  const onCookieChanged = (_event, cookie) => {
    if (cookie.name === "p_skey") cookieState.p_skey = cookie.value;
    if (cookie.name === "p_uin") cookieState.p_uin = cookie.value;
    if (cookieState.p_skey && cookieState.p_uin) {
      handleLoginSuccess();
    }
  };
  loginWindow.webContents.session.cookies.on("changed", onCookieChanged);

  // 拦截中转页跳转，避免 ERR_ADDRESS_INVALID 引起的空白渲染
  loginWindow.webContents.on("will-navigate", (event, url) => {
    if (url.includes("qzs.qq.com/qzone/v5/loginsucc.html")) {
      event.preventDefault();
    }
  });

  // 加载失败时输出明确日志，避免静默失败
  loginWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.warn(
        `[login] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`
      );
    }
  );

  loginWindow.loadURL(QQURL);

  // 兜底：保留 URL 判定逻辑，应对 Cookie 事件未触发的极端情况
  loginWindow.webContents.on("dom-ready", () => {
    if (loginSuccessHandled) return;
    const currentURL = loginWindow.webContents.getURL();
    if (currentURL.indexOf(`https://user.qzone.qq.com/`) !== -1) {
      handleLoginSuccess();
    }
  });

  loginWindow.on("closed", function () {
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.webContents.session.cookies.removeListener(
        "changed",
        onCookieChanged
      );
    }
    loginWindow = null;
    loginSuccessHandled = false;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", function () {
  if (loginWindow === null && mainWindow == null) createWindow();
});
