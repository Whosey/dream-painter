/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './index.css';



const els = {
  backendStatus: document.getElementById('backendStatus'),
  cameraStatus: document.getElementById('cameraStatus'),

  cameraVideo: document.getElementById('cameraVideo'),
  cameraSelect: document.getElementById('cameraSelect'),
  btnStartCamera: document.getElementById('btnStartCamera'),
  btnCapture: document.getElementById('btnCapture'),
  capturePreview: document.getElementById('capturePreview'),

  videoPlaceholder: document.getElementById('videoPlaceholder'),
  aiVideo: document.getElementById('aiVideo'),
  videoOverlay: document.getElementById('videoOverlay'),
  overlayText: document.getElementById('overlayText'),

  btnGenerate: document.getElementById('btnGenerate'),
  btnRegenerate: document.getElementById('btnRegenerate'),
  
  btnPrevStep: document.getElementById('btnPrevStep'),
  btnNextStep: document.getElementById('btnNextStep'),
  stepIndicator: document.getElementById('stepIndicator'),
  stepNav: document.getElementById('stepNav'),


  subtitleBar: document.getElementById('subtitleBar'),
  promptInput: document.getElementById('promptInput'),

  modal: document.getElementById('modal'),
  modalMsg: document.getElementById('modalMsg'),
  modalOk: document.getElementById('modalOk'),

  countdownOverlay: document.getElementById('countdownOverlay'),
  countdownNum: document.getElementById('countdownNum'),

};

const BACKEND_BASE = 'http://127.0.0.1:18080';

let mediaStream = null;      // 阶段四不再使用浏览器流，但保留变量以减少改动
let capturedBlob = null;     // 阶段四不再写入，后续可以移除
let tutorialSteps = null;  // { stepCount, timestamps[], prompts[] }
let currentStep = 0;
let pendingSeekTime = null; // 视频 metadata 未加载完成时暂存要跳的时间

let backendCameraOpened = false;
let previewTimerId = null;
let hasSnapshot = false;


function showModal(msg) {
  els.modalMsg.textContent = msg;
  els.modal.classList.remove('hidden');
}
els.modalOk.onclick = () => els.modal.classList.add('hidden');

function setVideoState(state, videoUrl) {
  if (state === 'idle') {
    els.videoPlaceholder.classList.remove('hidden');
    els.aiVideo.style.display = 'none';
    els.videoOverlay.classList.add('hidden');
    els.btnRegenerate.classList.add('hidden');
  }
  if (state === "captured") {
    els.videoPlaceholder?.classList.remove("hidden");
    els.aiVideo?.classList.add("hidden");
    els.videoOverlay?.classList.add("hidden");

    els.btnGenerate.disabled = false;
    els.btnRegenerate?.classList.add("hidden");

    showStepControls(false); 
  }
  
  if (state === 'generating') {
    els.videoOverlay.classList.remove('hidden');
    els.overlayText.textContent = 'AI 视频正在生成中...';
    els.btnGenerate.disabled = true;
  }
  if (state === 'ready') {
    els.videoOverlay.classList.add('hidden');
    els.videoPlaceholder.classList.add('hidden');
    els.aiVideo.style.display = 'block';
    if (videoUrl) els.aiVideo.src = videoUrl;
    els.btnRegenerate.classList.remove('hidden');
    els.btnGenerate.disabled = false;
  }
  if (state === 'error') {
    els.videoOverlay.classList.add('hidden');
    els.videoPlaceholder.classList.remove('hidden');
    els.aiVideo.style.display = 'none';
    els.btnGenerate.disabled = false;
  }
}

function showStepControls(hasSteps) {
  if (!els.stepNav) return;

  els.btnPrevStep?.classList.toggle("hidden", !hasSteps);
  els.btnNextStep?.classList.toggle("hidden", !hasSteps);
  els.stepIndicator?.classList.toggle("hidden", !hasSteps);
  els.btnRegenerate?.classList.toggle("hidden", !hasSteps);

  els.btnGenerate?.classList.toggle("hidden", hasSteps);
}




function normalizeSteps(rawSteps) {
  if (!rawSteps) return null;

  // 兼容 timestamps: 数组 或 对象（如 {"0":0,"1":2.5,"2":5.1}）
  let timestamps = [];
  if (Array.isArray(rawSteps.timestamps)) {
    timestamps = rawSteps.timestamps;
  } else if (rawSteps.timestamps && typeof rawSteps.timestamps === 'object') {
    timestamps = Object.keys(rawSteps.timestamps)
      .map(k => Number(k))
      .sort((a, b) => a - b)
      .map(k => Number(rawSteps.timestamps[k]));
  }

  // prompts 同理（可选）
  let prompts = [];
  if (Array.isArray(rawSteps.prompts)) prompts = rawSteps.prompts;
  else if (rawSteps.prompts && typeof rawSteps.prompts === 'object') {
    prompts = Object.keys(rawSteps.prompts)
      .map(k => Number(k))
      .sort((a, b) => a - b)
      .map(k => String(rawSteps.prompts[k]));
  }

  const stepCount =
    Number(rawSteps.stepCount) ||
    timestamps.length ||
    prompts.length ||
    0;

  return { stepCount, timestamps, prompts };
}

function updateStepUI() {
  if (!tutorialSteps || tutorialSteps.stepCount <= 0) {
    showStepControls(false);
    return;
  }

  showStepControls(true);

  const total = tutorialSteps.stepCount;
  const idx = currentStep;

  els.stepIndicator.textContent = `步骤 ${idx + 1}/${total}`;

  els.btnPrevStep.disabled = idx <= 0;
  els.btnNextStep.disabled = idx >= total - 1;

  // 底部字幕：优先用 prompts，没有就显示步骤号
  const promptText = tutorialSteps.prompts?.[idx];
  els.subtitleBar.textContent = promptText ? `第${idx + 1}步：${promptText}` : `已切换到第 ${idx + 1}/${total} 步`;
}

function gotoStep(nextIndex) {
  if (!tutorialSteps) return;

  const total = tutorialSteps.stepCount;
  if (total <= 0) return;

  // clamp 到合法范围
  currentStep = Math.max(0, Math.min(total - 1, nextIndex));
  updateStepUI();

  // 时间点跳转（同一个 mp4 视频里 seek）
  const t = tutorialSteps.timestamps?.[currentStep];
  const seekTime = Number.isFinite(t) ? t : 0;

  // 如果 metadata 还没加载好，先存起来，等 loadedmetadata 再跳
  if (els.aiVideo.readyState >= 1) {
    els.aiVideo.currentTime = seekTime;
    els.aiVideo.play().catch(() => {});
  } else {
    pendingSeekTime = seekTime;
    els.aiVideo.load();
  }
}


async function listCameras() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/camera/devices`);
    const json = await res.json();

    if (!json.success) {
      els.backendStatus.textContent = '后端：未连接';
      showModal(`获取摄像头列表失败：${json.code}\n${json.message || ''}`);
      return;
    }

    const cams = json.data?.devices || [];

    els.cameraSelect.innerHTML = '';
    cams.forEach((cam, idx) => {
      const opt = document.createElement('option');
      opt.value = String(cam.index);
      opt.textContent = cam.name || `摄像头 ${idx + 1}`;
      els.cameraSelect.appendChild(opt);
    });

    if (cams.length === 0) {
      els.backendStatus.textContent = '后端：已连接（未检测到摄像头）';
      showModal('未检测到摄像头设备。');
    } else {
      els.backendStatus.textContent = '后端：已连接';
    }
  } catch (e) {
    console.error('listCameras error', e);
    els.backendStatus.textContent = '后端：未连接';
    showModal('无法连接本地摄像头服务，请确认 java-hardware 已启动。');
  }
}

async function startCamera() {
  try {
    const selectedValue = els.cameraSelect.value;
    const index = Number(selectedValue);
    if (!Number.isFinite(index)) {
      showModal('请选择要开启的摄像头设备。');
      return;
    }

    els.cameraStatus.textContent = '摄像头：请求中...';
    hasSnapshot = false;
    els.btnGenerate.disabled = false; // 是否默认禁用由后续生成逻辑控制

    const res = await fetch(`${BACKEND_BASE}/api/camera/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceIndex: index }),
    });
    const json = await res.json();

    if (!json.success || json.data?.state !== 'PREVIEWING') {
      backendCameraOpened = false;
      els.cameraStatus.textContent = '摄像头：开启失败';
      showModal(`开启摄像头失败：${json.code}\n${json.message || ''}`);
      return;
    }

    backendCameraOpened = true;
    els.cameraStatus.textContent = '摄像头：已开启';
    els.btnCapture.disabled = false;

    // 左侧区域用作实时预览（来自后端 latest frame）
    els.cameraVideo.style.display = 'none';
    els.capturePreview.style.display = 'block';

    startPreviewPolling();
  } catch (e) {
    console.error('startCamera error', e);
    backendCameraOpened = false;
    els.cameraStatus.textContent = '摄像头：开启失败';
    showModal(
      `无法开启摄像头：${e.name || ''}\n${e.message || ''}\n\n排查：\n1) java-hardware 是否已启动\n2) 设备是否被其他程序占用`
    );
  }
}


function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runCountdown(from = 3) {
  if (!els.countdownOverlay || !els.countdownNum) return;

  els.countdownOverlay.classList.remove('hidden');

  for (let s = from; s >= 1; s--) {
    els.countdownNum.textContent = String(s);
    await sleep(900);
  }

  els.countdownOverlay.classList.add('hidden');
}




function startPreviewPolling() {
  if (previewTimerId) {
    clearInterval(previewTimerId);
  }

  previewTimerId = setInterval(async () => {
    try {
      const res = await fetch(`${BACKEND_BASE}/api/camera/preview/latest`);
      const json = await res.json();

      if (!json.success) {
        if (json.code === 'CAMERA_NOT_OPEN') {
          backendCameraOpened = false;
          els.cameraStatus.textContent = '摄像头：未开启';
          stopPreviewPolling();
        }
        // NO_LATEST_FRAME 等错误先忽略，等待下一次轮询
        return;
      }

      const img = json.data?.imageBase64;
      if (img) {
        els.capturePreview.src = img;
        els.capturePreview.style.display = 'block';
        els.cameraVideo.style.display = 'none';
      }
    } catch (e) {
      console.error('preview polling error', e);
    }
  }, 300);
}

function stopPreviewPolling() {
  if (previewTimerId) {
    clearInterval(previewTimerId);
    previewTimerId = null;
  }
}

async function captureFrame() {
  if (!backendCameraOpened) {
    showModal('请先开启摄像头。');
    return;
  }

  try {
    const res = await fetch(`${BACKEND_BASE}/api/capture/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const json = await res.json();

    if (!json.success) {
      showModal(`采集失败：${json.code}\n${json.message || ''}`);
      return;
    }

    hasSnapshot = true;
    els.btnGenerate.disabled = false;
    els.subtitleBar.textContent = '已采集图片，可点击“开始生成”。';
    // 预览区域仍由实时预览驱动，不在此处切换为抓拍结果
  } catch (e) {
    console.error('captureFrame error', e);
    showModal(`采集失败：${e.message || e}`);
  }
}

async function mockGenerate() {
  if (!hasSnapshot) {
    showModal('请先点击“采集一张”，再开始生成。');
    return;
  }

  // 清空旧步骤
  tutorialSteps = null;
  currentStep = 0;
  pendingSeekTime = null;
  showStepControls(false);

  setVideoState('generating');
  els.subtitleBar.textContent = '正在生成中（模拟 3 秒）...';

  await new Promise(r => setTimeout(r, 3000));

  // 这里用一个公开示例视频做演示（你接后端后换成后端返回的 tutorial.mp4）
  const demoVideo = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

  // 模拟 steps.json（真实后端会返回 timestamps/prompts）
  const mockSteps = {
    stepCount: 6,
    timestamps: [0, 2, 4, 6, 8, 10],
    prompts: [
      '先画一个大圆',
      '加上两只耳朵',
      '画眼睛和鼻子',
      '补上胡须',
      '画身体轮廓',
      '最后涂上颜色',
    ],
  };

  setVideoState('ready', demoVideo);

  tutorialSteps = normalizeSteps(mockSteps);
  updateStepUI();
  gotoStep(0); // 默认跳到第 1 步
}


els.aiVideo.addEventListener('loadedmetadata', () => {
  if (pendingSeekTime != null) {
    els.aiVideo.currentTime = pendingSeekTime;
    pendingSeekTime = null;
    els.aiVideo.play().catch(() => {});
  }
});



els.btnStartCamera.onclick = async () => {
  await startCamera();
};
els.cameraSelect.onchange = () => {
  // 第一版仅更新选中项，不自动调用 /api/camera/open
};

els.btnCapture.onclick = async () => {
  if (!backendCameraOpened) {
    showModal('请先开启摄像头。');
    return;
  }

  // 防止连点
  els.btnCapture.disabled = true;

  try {
    await runCountdown(3);
    await captureFrame();
  } finally {
    // 无论成功失败都恢复按钮
    els.btnCapture.disabled = false;
  }
};


els.btnGenerate.onclick = mockGenerate;
els.btnRegenerate.onclick = mockGenerate;
els.btnPrevStep.onclick = () => gotoStep(currentStep - 1);
els.btnNextStep.onclick = () => gotoStep(currentStep + 1);


setVideoState('idle');
els.backendStatus.textContent = '后端：未连接（先把前端跑通）';
listCameras().catch(() => {});
showStepControls(false);