const STORAGE_KEY = "fragments-of-nga-project-v1";
const DB_NAME = "fragments-of-nga-cms";
const DB_STORE = "projects";
const DB_PROJECT_KEY = "active-project";
const DEFAULT_BOARD_IMAGE = "public/memories/BG.jpg";
const DEFAULT_BOARD_IMAGE_VERSION = "bg-jpg-board-v1";
const DEFAULT_BOARD_SIZE = { width: 820, height: 1752 };
const PHOTO_COUNT = 40;
const PHOTO_FOLDER_VERSION = "numbered-photo-folder-v1";
const PROJECT_SYNC_INTERVAL = 2500;
const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "m4v"];
const BACKGROUND_MUSIC_VOLUME = 0.42;
const VIDEO_DUCK_GAIN = 10 ** (-5 / 20);
const isAdminMode = new URLSearchParams(location.search).has("admin");
const hasCmsServer = () => {
  const host = location.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
};

const board = document.querySelector("[data-board]");
const siteTitle = document.querySelector("[data-site-title]");
const detail = document.querySelector("[data-detail]");
const detailPhoto = document.querySelector("[data-detail-photo]");
const detailVideo = document.querySelector("[data-detail-video]");
const detailVideoPlay = document.querySelector("[data-video-play]");
const detailDate = document.querySelector("[data-date]");
const detailTitle = document.querySelector("[data-title]");
const detailNote = document.querySelector("[data-note]");
const viewAll = document.querySelector("[data-ending]");
const endingCopy = document.querySelector("[data-ending-copy]");
const birthdayText = document.querySelector("[data-birthday-text]");
const footer = document.querySelector("[data-footer]");
const audio = document.querySelector("[data-audio]");
const musicButton = document.querySelector("[data-music]");
const musicStatus = document.querySelector("[data-music-status]");
const adminToggle = document.querySelector("[data-admin-toggle]");
const adminPanel = document.querySelector("[data-admin-panel]");
const selectedEditor = document.querySelector("[data-selected-editor]");
const mediaGrid = document.querySelector("[data-media-grid]");
const photoTextTable = document.querySelector("[data-photo-text-table]");
const jsonOutput = document.querySelector("[data-json-output]");

let project;
let selected = null;
let opened = new Set();
let mode = "entry";
let view = { scale: 1, x: 0, y: 0 };
let selectedItem = null;
let dragState = null;
let tapState = null;
let panStart = null;
let pinchStart = null;
let gestureMoved = false;
let returnViewBeforeFocus = null;
let activeDetailVideoSrc = "";
let audioPlaylist = [];
let currentAudioIndex = 0;
let backgroundMusicDesired = false;
let shouldResumeMusicAfterVideo = false;
let isMusicDuckedForVideo = false;
let videoManifestFiles = null;
const pointers = new Map();
const pendingThemeFiles = new Map();
const pendingLayerFiles = new Map();
let mediaFilter = "photo";
let saveTimer = null;
let serverProjectMeta = null;
let remoteSyncTimer = null;
let isApplyingRemoteProject = false;
const projectChannel = "BroadcastChannel" in window ? new BroadcastChannel("fragments-of-nga-project") : null;

const fallbackProject = {
  title: "Fragments of Ngà",
  receiver: "Ngà",
  birthdayText: "Hôm nay cũng hãy vui nha.",
  footer: "tap một tấm ảnh để camera tự focus",
  backgroundColor: "#d5bf96",
  backgroundImage: "",
  layers: {
    background: {
      image: "",
      blur: 0,
      brightness: 1,
      contrast: 1,
      saturation: 1,
      opacity: 0
    },
    board: {
      image: DEFAULT_BOARD_IMAGE,
      sourceVersion: DEFAULT_BOARD_IMAGE_VERSION
    }
  },
  theme: {
    preset: "sunrise",
    appBackgroundImage: "",
    backgroundBlur: 0,
    backgroundOpacity: 0,
    backgroundPositionX: 50,
    backgroundPositionY: 50,
    corkTextureImage: "",
    corkTextureOpacity: 1,
    corkColor: "#d5bf96",
    frameImage: "",
    frameColor: "#8a5b2e",
    boardBackdropImage: "",
    lightColor: "#ffebb0",
    warmth: 0.08,
    brightness: 1,
    contrast: 1,
    saturation: 1,
    decorTone: "flowers"
  },
  board: { ...DEFAULT_BOARD_SIZE },
  media: [
    { id: "contact-light", name: "Warm contact sheet", type: "photo", src: "public/memories/light-contact-sheet.png" },
    { id: "default-board-bg", name: "BG board image", type: "board", src: DEFAULT_BOARD_IMAGE }
  ],
  photos: [],
  notes: [],
  decor: []
};

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function photoMediaId(number) {
  return `folder-photo-${number}`;
}

function photoFolderSrc(number) {
  return `public/photos/${number}.png`;
}

function imageCssSources(src) {
  const match = String(src || "").match(/^public\/photos\/(\d+)\.(png|jpe?g|webp)$/i);
  if (!match) return `url("${src}")`;
  const base = `public/photos/${match[1]}`;
  return [`${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`].map((candidate) => `url("${candidate}")`).join(", ");
}

function imageSourceCandidates(src) {
  if (!src || src.startsWith("data:")) return src ? [src] : [];
  const match = String(src).match(/^public\/photos\/(\d+)\.(png|jpe?g|webp)$/i);
  if (!match) return [src];
  const base = `public/photos/${match[1]}`;
  return [...new Set([src, `${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`])];
}

function loadImageSize(src) {
  const candidates = imageSourceCandidates(src);
  return new Promise((resolve) => {
    const loadNext = (index) => {
      const candidate = candidates[index];
      if (!candidate) {
        resolve(null);
        return;
      }

      const image = new Image();
      image.onload = () => resolve({
        src: candidate,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
      });
      image.onerror = () => loadNext(index + 1);
      image.src = candidate;
    };

    loadNext(0);
  });
}

function videoCandidatesForPhoto(photo, media) {
  if (photo.videoSrc) return [photo.videoSrc];
  if (photo.photoNumber) {
    return [
      ...VIDEO_EXTENSIONS.map((extension) => `public/photos/${photo.photoNumber}.${extension}`),
      ...VIDEO_EXTENSIONS.map((extension) => `public/videos/${photo.photoNumber}.${extension}`)
    ];
  }

  const match = String(media?.src || "").match(/^(.*)\.[a-z0-9]+$/i);
  if (!match || media.src.startsWith("data:")) return [];
  const base = match[1];
  const name = base.split("/").pop();
  return [
    ...VIDEO_EXTENSIONS.map((extension) => `${base}.${extension}`),
    ...VIDEO_EXTENSIONS.map((extension) => `public/videos/${name}.${extension}`)
  ];
}

async function firstExistingVideo(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.startsWith("data:")) return candidate;
    if (videoManifestFiles?.has(candidate.replace(/^\.\//, ""))) return candidate;
    try {
      const response = await fetch(candidate, { method: "HEAD", cache: "no-store" });
      if (response.ok) return candidate;
    } catch {
      try {
        const fallback = await fetch(candidate, { cache: "no-store" });
        if (fallback.ok) return candidate;
      } catch {
        // Optional video files are allowed to be missing.
      }
    }
  }
  return "";
}

async function setupVideoManifest() {
  try {
    const response = await fetch("public/videos/manifest.json", { cache: "no-store" });
    const data = response.ok ? await response.json() : null;
    const files = Array.isArray(data?.files) ? data.files : [];
    videoManifestFiles = new Set(files.map((file) => String(file).replace(/\\/g, "/").replace(/^\.\//, "")));
  } catch {
    videoManifestFiles = null;
  }
}

async function prepareDetailVideo(photo, media) {
  activeDetailVideoSrc = "";
  detailVideoPlay.hidden = true;
  detailVideoPlay.disabled = true;
  const videoSrc = await firstExistingVideo(videoCandidatesForPhoto(photo, media));
  if (!selected || selected.id !== photo.id || !videoSrc) return;
  activeDetailVideoSrc = videoSrc;
  detailVideoPlay.hidden = false;
  detailVideoPlay.disabled = false;
}

function defaultPhotoLayout(number) {
  const presets = {
    36: { x: 62, y: 1428, w: 150, h: 178, rotation: -5, z: 25 },
    37: { x: 224, y: 1434, w: 176, h: 142, rotation: 4, z: 24 },
    38: { x: 418, y: 1418, w: 154, h: 184, rotation: -3, z: 26 },
    39: { x: 590, y: 1436, w: 160, h: 172, rotation: 5, z: 25 },
    40: { x: 324, y: 1580, w: 174, h: 142, rotation: -4, z: 27 }
  };
  if (presets[number]) return presets[number];
  const index = number - 1;
  return {
    x: 58 + (index % 4) * 178,
    y: 80 + Math.floor(index / 4) * 166,
    w: index % 3 === 0 ? 176 : 152,
    h: index % 2 === 0 ? 178 : 146,
    rotation: [-6, 4, -3, 6, -4][index % 5],
    z: 18 + (index % 12)
  };
}

async function init() {
  setupAudioPlaylist();
  setupVideoManifest();
  const storedProject = await loadProject();
  if (storedProject) {
    project = storedProject;
  } else {
    try {
      const response = await fetch("project.json", { cache: "no-store" });
      project = response.ok ? await response.json() : structuredClone(fallbackProject);
    } catch {
      project = structuredClone(fallbackProject);
    }
  }

  normalizeProject();
  adminToggle.hidden = !isAdminMode;
  renderAll({ persist: false });
  bindAdmin();
  startProjectSync();
}

function normalizeProject() {
  project.media ??= fallbackProject.media;
  project.photos ??= [];
  project.notes ??= [];
  project.decor ??= [];
  project.board ??= { ...DEFAULT_BOARD_SIZE };
  project.theme = { ...fallbackProject.theme, ...(project.theme ?? {}) };
  project.layers = {
    background: { ...fallbackProject.layers.background, ...(project.layers?.background ?? {}) },
    board: { ...fallbackProject.layers.board, ...(project.layers?.board ?? {}) }
  };
  project.media = project.media.map((item) => ({ type: "photo", ...item }));
  if (!project.media.some((item) => item.src === DEFAULT_BOARD_IMAGE)) {
    project.media.push({ id: "default-board-bg", name: "BG board image", type: "board", src: DEFAULT_BOARD_IMAGE });
  }
  ensureNumberedPhotoMedia();
  if (!project.layers.board.image || project.layers.board.sourceVersion !== DEFAULT_BOARD_IMAGE_VERSION) {
    project.layers.board.image = DEFAULT_BOARD_IMAGE;
    project.layers.board.sourceVersion = DEFAULT_BOARD_IMAGE_VERSION;
    project.board = { ...DEFAULT_BOARD_SIZE };
  }
  if (project.layers.board.image === DEFAULT_BOARD_IMAGE) {
    project.board = { ...DEFAULT_BOARD_SIZE };
  }
  normalizeNumberedPhotos();
  project.decor = project.decor
    .filter((item) => item.type !== "flower")
    .map((item) => ({ mediaId: item.mediaId || "", ...item }));
}

function ensureNumberedPhotoMedia() {
  for (let number = 1; number <= PHOTO_COUNT; number += 1) {
    const id = photoMediaId(number);
    const existing = project.media.find((item) => item.id === id);
    if (existing) {
      existing.type = "photo";
      existing.name = `Photo ${number}`;
      existing.src = photoFolderSrc(number);
    } else {
      project.media.push({
        id,
        name: `Photo ${number}`,
        type: "photo",
        src: photoFolderSrc(number)
      });
    }
  }
}

function normalizeNumberedPhotos() {
  const previousPhotos = project.photos.map((photo) => ({
    detailNote: "",
    videoSrc: "",
    videoName: "",
    ...photo
  }));
  const byNumber = new Map(previousPhotos.filter((photo) => photo.photoNumber).map((photo) => [Number(photo.photoNumber), photo]));
  const shouldMigrate =
    project.photoSourceVersion !== PHOTO_FOLDER_VERSION ||
    previousPhotos.length < PHOTO_COUNT ||
    previousPhotos.slice(0, PHOTO_COUNT).some((photo, index) => Number(photo.photoNumber) !== index + 1);

  if (!shouldMigrate) {
    project.photos = previousPhotos;
    return;
  }

  const numberedPhotos = [];
  for (let number = 1; number <= PHOTO_COUNT; number += 1) {
    const existing = byNumber.get(number) || previousPhotos[number - 1] || {};
    numberedPhotos.push({
      id: existing.id || `photo-${number}`,
      ...defaultPhotoLayout(number),
      ...existing,
      photoNumber: number,
      mediaId: photoMediaId(number),
      crop: "center",
      caption: existing.caption || `ảnh ${number}`,
      detailNote: existing.detailNote || "",
      videoSrc: existing.videoSrc || "",
      videoName: existing.videoName || ""
    });
  }

  const extras = previousPhotos.filter((photo, index) => index >= PHOTO_COUNT && !photo.photoNumber);
  project.photos = [...numberedPhotos, ...extras];
  project.photoSourceVersion = PHOTO_FOLDER_VERSION;
}

function saveProject() {
  if (isApplyingRemoteProject) {
    updateDataPreview();
    return;
  }

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (isAdminMode && hasCmsServer()) {
      project.updatedAt = new Date().toISOString();
      saveProjectToServer(project).catch(() => {});
    }
    saveProjectToIndexedDb(project).catch(() => {});

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(createLightweightProject(project)));
    } catch {
      // IndexedDB remains the primary persistence path for uploaded images.
    }
  }, 220);

  updateDataPreview();
}

async function loadProject() {
  if (hasCmsServer()) {
    const serverProject = await loadProjectFromServer().catch(() => null);
    if (serverProject) return serverProject;
  }

  const indexedProject = await loadProjectFromIndexedDb().catch(() => null);
  if (indexedProject) return indexedProject;

  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : null;
}

async function loadProjectFromServer() {
  const response = await fetch("/api/project", { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json();
  serverProjectMeta = await loadProjectMeta().catch(() => null);
  return data;
}

async function loadProjectMeta() {
  const response = await fetch("/api/project-meta", { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

async function saveProjectToServer(value) {
  const response = await fetch("/api/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  if (!response.ok) throw new Error("Project server save failed");
  const result = await response.json().catch(() => null);
  if (result?.meta) serverProjectMeta = result.meta;
  projectChannel?.postMessage({ type: "project-saved", meta: serverProjectMeta });
}

function hasServerProjectChanged(nextMeta) {
  if (!nextMeta?.exists) return false;
  if (!serverProjectMeta?.exists) return false;
  return nextMeta.mtimeNs !== serverProjectMeta.mtimeNs || nextMeta.size !== serverProjectMeta.size;
}

function reconcileOpenDetail() {
  if (!selected) return;
  selected = project.photos.find((photo) => photo.id === selected.id) || null;
  if (!selected) {
    mode = "entry";
  }
}

async function refreshProjectFromServer(force = false) {
  const nextMeta = await loadProjectMeta().catch(() => null);
  if (!nextMeta?.exists) return;

  if (!serverProjectMeta) {
    serverProjectMeta = nextMeta;
    if (!force) return;
  }

  if (!force && !hasServerProjectChanged(nextMeta)) return;

  const response = await fetch("/api/project", { cache: "no-store" });
  if (!response.ok) return;
  const nextProject = await response.json();
  serverProjectMeta = nextMeta;
  project = nextProject;
  normalizeProject();
  reconcileOpenDetail();

  isApplyingRemoteProject = true;
  renderAll({ persist: false });
  isApplyingRemoteProject = false;
}

function startProjectSync() {
  if (isAdminMode) return;
  if (!hasCmsServer()) return;

  projectChannel?.addEventListener("message", (event) => {
    if (event.data?.type === "project-saved") {
      refreshProjectFromServer(true);
    }
  });

  remoteSyncTimer = setInterval(() => refreshProjectFromServer(false), PROJECT_SYNC_INTERVAL);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshProjectFromServer(false);
  });
  addEventListener("focus", () => refreshProjectFromServer(false));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function saveProjectToIndexedDb(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, DB_PROJECT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadProjectFromIndexedDb() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const request = tx.objectStore(DB_STORE).get(DB_PROJECT_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function clearSavedProject() {
  localStorage.removeItem(STORAGE_KEY);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(DB_PROJECT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function mediaById(id) {
  return project.media.find((item) => item.id === id) ?? project.media[0];
}

function isPhotoItem(item) {
  return project?.photos?.some((photo) => photo.id === item?.id);
}

function createLightweightProject(value) {
  return {
    ...value,
    photos: value.photos.map((photo) => ({
      ...photo,
      videoSrc: photo.videoSrc?.startsWith("data:") ? "" : photo.videoSrc
    })),
    media: value.media.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type || "photo",
      src: item.src?.startsWith("data:") ? "" : item.src
    })),
    backgroundImage: value.backgroundImage?.startsWith("data:") ? "" : value.backgroundImage,
    layers: {
      background: {
        ...value.layers.background,
        image: value.layers.background.image?.startsWith("data:") ? "" : value.layers.background.image
      },
      board: {
        ...value.layers.board,
        image: value.layers.board.image?.startsWith("data:") ? "" : value.layers.board.image
      }
    },
    theme: {
      ...value.theme,
      appBackgroundImage: "",
      corkTextureImage: "",
      frameImage: "",
      boardBackdropImage: ""
    }
  };
}

function updateDataPreview() {
  if (!isAdminMode || !jsonOutput) return;
  const dataSection = document.querySelector('[data-section="data"]');
  if (!dataSection?.classList.contains("is-active")) return;

  const imageCount = project.media.filter((item) => item.src?.startsWith("data:")).length;
  const mediaSize = project.media.reduce((total, item) => total + (item.src?.length || 0), 0);
  const videoSize = project.photos.reduce((total, photo) => total + (photo.videoSrc?.length || 0), 0);
  const layerSize = (project.layers.background.image?.length || 0) + (project.layers.board.image?.length || 0);
  const jsonSize = Math.round((JSON.stringify(createLightweightProject(project)).length + mediaSize + videoSize + layerSize) / 1024);
  jsonOutput.value = [
    "Data preview nhẹ để tránh treo trình duyệt.",
    "",
    `Title: ${project.title || ""}`,
    `Receiver: ${project.receiver || ""}`,
    `Photos on board: ${project.photos.length}`,
    `Notes: ${project.notes.length}`,
    `Decorations: ${project.decor.length}`,
    `Media files: ${project.media.length}`,
    `Uploaded image data: ${imageCount}`,
    `Estimated export size: ${jsonSize.toLocaleString("vi-VN")} KB`,
    "",
    "Bấm Export Project JSON để tải file project đầy đủ gồm cả ảnh."
  ].join("\n");
}

function renderAll({ persist = true } = {}) {
  renderContent();
  renderBoard();
  renderMediaLibrary();
  renderSelectedEditor();
  renderPhotoTextTable();
  if (persist) saveProject();
  renderBoardTransform();
}

function renderContent() {
  document.title = project.title || "Fragments of Ngà";
  siteTitle.innerHTML = `${escapeHtml(project.title || "Fragments of Ngà").replace(/\s+of\s+/i, "<br />of ")}`;
  birthdayText.textContent = `Happy Birthday, ${project.receiver || "Ngà"}.`;
  footer.textContent = project.footer || "";
  document.querySelector("[data-ending-line]").textContent = project.endingText || "Glad you were part of this year.";
  board.style.width = `${project.board.width}px`;
  board.style.height = `${project.board.height}px`;
  applyTheme();

  document.querySelector('[data-field="title"]').value = project.title || "";
  document.querySelector('[data-field="receiver"]').value = project.receiver || "";
  document.querySelector('[data-field="birthdayText"]').value = project.birthdayText || "";
  document.querySelector('[data-field="endingText"]').value = project.endingText || "";
  document.querySelector('[data-field="footer"]').value = project.footer || "";
  document.querySelector('[data-field="backgroundColor"]').value = project.backgroundColor || "#d5bf96";
  syncThemeControls();
  syncLayerControls();
}

const themePresets = {
  sunrise: {
    backgroundColor: "#d8bd91",
    appA: "#7b4b24",
    appB: "#241207",
    lightColor: "rgba(255, 228, 160, 0.48)",
    frameColor: "#8a5b2e",
    warmth: 0.08,
    brightness: 1.05,
    contrast: 1,
    saturation: 1.06
  },
  "golden-hour": {
    backgroundColor: "#d4ad72",
    appA: "#7a431d",
    appB: "#180b04",
    lightColor: "rgba(255, 202, 106, 0.56)",
    frameColor: "#75431f",
    warmth: 0.16,
    brightness: 1.08,
    contrast: 1.08,
    saturation: 1.12
  },
  "cozy-cafe": {
    backgroundColor: "#b99367",
    appA: "#4a2d1e",
    appB: "#150c08",
    lightColor: "rgba(238, 175, 92, 0.42)",
    frameColor: "#6b4126",
    warmth: 0.22,
    brightness: 0.96,
    contrast: 1.12,
    saturation: 0.94
  },
  "vintage-film": {
    backgroundColor: "#c1a077",
    appA: "#51402d",
    appB: "#16110c",
    lightColor: "rgba(230, 197, 135, 0.34)",
    frameColor: "#6a4a2d",
    warmth: 0.3,
    brightness: 0.94,
    contrast: 1.18,
    saturation: 0.82
  },
  "spring-garden": {
    backgroundColor: "#d9c89c",
    appA: "#61724a",
    appB: "#1c2115",
    lightColor: "rgba(255, 238, 172, 0.4)",
    frameColor: "#7d613b",
    warmth: 0.04,
    brightness: 1.09,
    contrast: 0.96,
    saturation: 1.18,
    decorTone: "leaves"
  },
  "minimal-beige": {
    backgroundColor: "#d9c7a7",
    appA: "#c8b18c",
    appB: "#69533d",
    lightColor: "rgba(255, 244, 211, 0.28)",
    frameColor: "#9b7348",
    warmth: 0,
    brightness: 1.04,
    contrast: 0.9,
    saturation: 0.78,
    decorTone: "paper"
  }
};

function applyTheme() {
  const theme = project.theme;
  const preset = themePresets[theme.preset] ?? themePresets.sunrise;
  const corkColor = theme.corkColor || project.backgroundColor || preset.backgroundColor;
  const frameColor = theme.frameColor || preset.frameColor;
  const lightColor = hexToRgba(theme.lightColor || "#ffebb0", 0.42);

  document.body.style.setProperty("--app-bg-a", preset.appA);
  document.body.style.setProperty("--app-bg-b", preset.appB);
  document.body.style.setProperty("--app-light", lightColor);
  document.body.style.setProperty("--app-bg-image", theme.appBackgroundImage ? `url("${theme.appBackgroundImage}")` : "none");
  document.body.style.setProperty("--app-bg-blur", `${theme.backgroundBlur ?? 0}px`);
  document.body.style.setProperty("--app-bg-opacity", theme.backgroundOpacity ?? 0);
  document.body.style.setProperty("--app-bg-position", `${theme.backgroundPositionX ?? 50}% ${theme.backgroundPositionY ?? 50}%`);
  document.body.classList.remove("decor-flowers", "decor-leaves", "decor-fairy-lights", "decor-paper");
  document.body.classList.add(`decor-${theme.decorTone || preset.decorTone || "flowers"}`);

  board.style.setProperty("--board-bg", corkColor);
  board.style.setProperty("--board-image", project.backgroundImage ? `url("${project.backgroundImage}")` : "none");
  board.style.setProperty("--cork-texture", theme.corkTextureImage ? `url("${theme.corkTextureImage}")` : "none");
  board.style.setProperty("--cork-texture-opacity", theme.corkTextureOpacity ?? 1);
  board.style.setProperty("--frame-color", frameColor);
  board.style.setProperty("--frame-image", theme.frameImage ? `url("${theme.frameImage}")` : "none");
  board.style.setProperty("--board-backdrop", theme.boardBackdropImage ? `url("${theme.boardBackdropImage}")` : "none");
  board.style.setProperty("--light-color", lightColor);
  board.style.setProperty("--theme-warmth", theme.warmth ?? preset.warmth);
  board.style.setProperty("--theme-brightness", theme.brightness ?? preset.brightness);
  board.style.setProperty("--theme-contrast", theme.contrast ?? preset.contrast);
  board.style.setProperty("--theme-saturation", theme.saturation ?? preset.saturation);

  applyLayers();
}

function applyLayers() {
  const background = project.layers.background;
  const boardLayer = project.layers.board;
  const boardImage = boardLayer.image || DEFAULT_BOARD_IMAGE;
  document.body.classList.toggle("has-plain-background-image", Boolean(background.image));
  document.body.style.setProperty("--layer-bg-image", background.image ? `url("${background.image}")` : "none");
  document.body.style.setProperty("--layer-bg-opacity", background.opacity ?? 0);
  document.body.style.setProperty("--layer-bg-filter", `blur(${background.blur ?? 0}px) brightness(${background.brightness ?? 1}) contrast(${background.contrast ?? 1}) saturate(${background.saturation ?? 1})`);
  board.style.setProperty("--single-board-image", `url("${boardImage}")`);
}

function syncThemeControls() {
  if (!isAdminMode) return;
  document.querySelectorAll("[data-theme-field]").forEach((field) => {
    const value = project.theme[field.dataset.themeField];
    if (value !== undefined) field.value = value;
  });
  const cork = document.querySelector('[data-theme-field="corkColor"]');
  if (cork) cork.value = project.theme.corkColor || project.backgroundColor || "#d5bf96";
}

function syncLayerControls() {
  if (!isAdminMode) return;
  document.querySelectorAll("[data-layer-field]").forEach((field) => {
    const value = getPath(project.layers, field.dataset.layerField);
    if (value !== undefined) field.value = value;
  });
}

function renderBoard() {
  board.innerHTML = "";
  const boardImageLayer = document.createElement("div");
  boardImageLayer.className = "board-image-layer";
  boardImageLayer.style.backgroundImage = `url("${project.layers?.board?.image || DEFAULT_BOARD_IMAGE}")`;
  board.appendChild(boardImageLayer);

  [
    ...project.decor.map((item) => ({ kind: "decor", item })),
    ...project.photos.map((item) => ({ kind: "photo", item })),
    ...project.notes.map((item) => ({ kind: "note", item }))
  ]
    .sort((a, b) => (a.item.z ?? 1) - (b.item.z ?? 1))
    .forEach(({ kind, item }) => {
      if (kind === "photo") renderPhoto(item);
      else if (kind === "note") renderNote(item);
      else renderDecor(item);
    });

}

function layeredItems() {
  return [
    ...(project.decor || []),
    ...(project.photos || []),
    ...(project.notes || [])
  ];
}

function bringItemToFront(item) {
  const highestLayer = layeredItems().reduce((highest, current) => Math.max(highest, Number(current.z || 1)), 1);
  item.z = Math.max(Number(item.z || 1), highestLayer + 1);
}

function setPositionStyles(element, item) {
  element.style.left = `${item.x}px`;
  element.style.top = `${item.y}px`;
  element.style.width = `${item.w}px`;
  element.style.height = `${item.h}px`;
  element.style.zIndex = String(item.z ?? 1);
  element.style.transform = `rotate(${item.rotation ?? 0}deg)`;
  element.dataset.id = item.id;
  element.dataset.kind = isPhotoItem(item) ? "photo" : "text" in item ? "note" : "decor";
  if (isAdminMode) element.classList.toggle("is-selected", selectedItem?.id === item.id);
}

function renderPhoto(photo) {
  const media = mediaById(photo.mediaId);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "photo editable-item";
  setPositionStyles(button, photo);
  const caption = photo.caption || "";
  button.style.setProperty("--photo-w", Number(photo.w || 150));
  button.innerHTML = `<span class="tape top"></span><span class="photo-img"></span><span class="caption"></span>`;
  button.querySelector(".photo-img").style.backgroundImage = `linear-gradient(rgba(255,232,176,.04), rgba(84,46,19,.12)), ${imageCssSources(media.src)}`;
  button.querySelector(".photo-img").style.backgroundPosition = photo.crop || "center";
  button.querySelector(".photo-img").style.backgroundSize = media.src.startsWith("data:") || media.src.includes("public/photos/") ? "cover" : "400% 300%";
  button.querySelector(".caption").textContent = caption;
  addEditorHandles(button, photo);
  bindBoardItem(button, photo);
  board.appendChild(button);
}

function renderNote(note) {
  const element = document.createElement("div");
  element.className = "note editable-item";
  setPositionStyles(element, note);
  element.style.background = note.color || "#d8bd8d";
  element.textContent = note.text || "";
  addEditorHandles(element, note);
  bindBoardItem(element, note);
  board.appendChild(element);
}

function renderDecor(decor) {
  const element = document.createElement("div");
  element.className = `editable-item ${decor.mediaId ? "decoration-image" : decor.type === "flower" ? "flowers" : `scrap scrap-${decor.type}`}`;
  setPositionStyles(element, decor);
  if (decor.mediaId) {
    const media = mediaById(decor.mediaId);
    element.innerHTML = `<img src="${media.src}" alt="" />`;
  } else if (decor.type === "flower") {
    element.innerHTML = "<i></i><i></i><i></i><i></i>";
  } else if (decor.type === "receipt") {
    element.innerHTML = "<span>THE COFFEE HOUSE</span><b>22.04</b><small>for here</small>";
  } else if (decor.type === "ticket") {
    element.innerHTML = "<span>CINEMA</span><b>22.04</b><small>admit one</small>";
  } else {
    element.innerHTML = "<span>vintage paper</span>";
  }
  addEditorHandles(element, decor);
  bindBoardItem(element, decor);
  board.appendChild(element);
}

function addEditorHandles(element, item) {
  if (!isAdminMode || selectedItem?.id !== item.id) return;
  element.insertAdjacentHTML(
    "beforeend",
    `<span class="editor-handle editor-rotate" data-editor-action="rotate" aria-hidden="true"></span>
     <span class="editor-handle editor-resize" data-editor-action="resize" aria-hidden="true"></span>`
  );
}

function bindBoardItem(element, item) {
  element.addEventListener("pointerdown", (event) => {
    if (!isAdminMode) {
      if (isPhotoItem(item) && !selected) {
        event.preventDefault();
        event.stopPropagation();
        element.setPointerCapture(event.pointerId);
        beginViewerGesture(event);
        if (pointers.size === 1) {
          tapState = {
            item,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            moved: false
          };
        } else {
          tapState = null;
        }
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    element.setPointerCapture(event.pointerId);
    selectedItem = item;
    bringItemToFront(item);
    board.querySelectorAll(".is-selected").forEach((selectedElement) => selectedElement.classList.remove("is-selected"));
    board.querySelectorAll(".editor-handle").forEach((handle) => handle.remove());
    element.classList.add("is-selected");
    element.style.zIndex = String(item.z ?? 1);
    addEditorHandles(element, item);
    const action = event.target.dataset.editorAction || "move";
    dragState = {
      action,
      item,
      startX: event.clientX,
      startY: event.clientY,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      rotation: item.rotation || 0
    };
    renderSelectedEditor();
  });

  element.addEventListener("pointermove", (event) => {
    if (!isAdminMode && isPhotoItem(item) && !selected && pointers.has(event.pointerId)) {
      updateViewerGesture(event);
      if (pointers.size > 1) {
        if (tapState?.item.id === item.id) tapState = null;
        return;
      }
    }

    if (tapState?.item.id === item.id && tapState.pointerId === event.pointerId) {
      const moved = Math.hypot(event.clientX - tapState.startX, event.clientY - tapState.startY);
      if (moved > 10) {
        tapState.moved = true;
        gestureMoved = true;
        mode = "manual";
        view.x += event.clientX - tapState.lastX;
        view.y += event.clientY - tapState.lastY;
        tapState.lastX = event.clientX;
        tapState.lastY = event.clientY;
        applyView();
      }
      return;
    }
    if (!dragState || dragState.item.id !== item.id) return;
    event.preventDefault();
    const deltaX = (event.clientX - dragState.startX) / view.scale;
    const deltaY = (event.clientY - dragState.startY) / view.scale;

    if (dragState.action === "resize") {
      item.w = Math.round(Math.max(42, dragState.w + deltaX));
      item.h = Math.round(Math.max(42, dragState.h + deltaY));
    } else if (dragState.action === "rotate") {
      item.rotation = Math.round(dragState.rotation + (event.clientX - dragState.startX) * 0.32);
    } else {
      item.x = Math.round(dragState.x + deltaX);
      item.y = Math.round(dragState.y + deltaY);
    }

    applyElementPosition(element, item);
    saveProject();
  });

  element.addEventListener("pointerup", (event) => {
    if (tapState?.item.id === item.id && tapState.pointerId === event.pointerId) {
      element.releasePointerCapture?.(event.pointerId);
      const shouldOpen = !tapState.moved && isPhotoItem(item) && !selected;
      tapState = null;
      endViewerGesture(event);
      if (shouldOpen) openPhoto(item);
      return;
    }
    element.releasePointerCapture?.(event.pointerId);
    if (!isAdminMode && isPhotoItem(item) && !selected) {
      endViewerGesture(event);
      return;
    }
    dragState = null;
    renderAll();
  });

  element.addEventListener("pointercancel", (event) => {
    if (!isAdminMode && isPhotoItem(item) && !selected) endViewerGesture(event);
  });

  element.addEventListener("click", (event) => {
    if (!isAdminMode) {
      event.preventDefault();
      event.stopPropagation();
      if (gestureMoved) {
        gestureMoved = false;
        return;
      }
      if (isPhotoItem(item) && !selected) openPhoto(item);
      return;
    }
    if (isAdminMode) {
      event.stopPropagation();
      selectedItem = item;
      renderAll();
      return;
    }
    if (isPhotoItem(item) && !gestureMoved) openPhoto(item);
  });
}

function applyElementPosition(element, item) {
  element.style.left = `${item.x}px`;
  element.style.top = `${item.y}px`;
  element.style.width = `${item.w}px`;
  element.style.height = `${item.h}px`;
  element.style.zIndex = String(item.z ?? 1);
  element.style.transform = `rotate(${item.rotation ?? 0}deg)`;
}

function ensureItemSizeBaseline(item) {
  item.baseW = Number(item.baseW || item.w || 120);
  item.baseH = Number(item.baseH || item.h || 140);
  item.scale = Number(item.scale || Math.round((Number(item.w || item.baseW) / item.baseW) * 100) || 100);
  return item.scale;
}

function setItemScale(item, percent) {
  ensureItemSizeBaseline(item);
  const nextScale = Math.max(35, Math.min(220, Math.round(Number(percent) || 100)));
  item.scale = nextScale;
  item.w = Math.round(item.baseW * nextScale / 100);
  item.h = Math.round(item.baseH * nextScale / 100);
}

function renderSelectedEditor() {
  if (!isAdminMode || !selectedEditor) return;
  if (!selectedItem) {
    selectedEditor.innerHTML = "<p>Chọn một ảnh/note trên board để sửa.</p>";
    return;
  }

  const isPhoto = isPhotoItem(selectedItem);
  const isNote = "text" in selectedItem;
  const sizeScale = isPhoto ? ensureItemSizeBaseline(selectedItem) : 100;
  selectedEditor.innerHTML = `
    <div class="editor-grid">
      ${isPhoto ? `<label>Caption <input data-edit="caption" value="${escapeAttr(selectedItem.caption || "")}" /></label>` : ""}
      ${isPhoto ? `<label>Detail note <textarea data-edit="detailNote" placeholder="Note hiện khi tap ảnh">${escapeHtml(selectedItem.detailNote || "")}</textarea></label>` : ""}
      ${isPhoto ? `<label class="size-control">Kích thước ảnh <span data-scale-value>${sizeScale}%</span><input type="range" min="35" max="220" step="1" data-size-scale value="${sizeScale}" /></label>` : ""}
      ${isNote ? `<label>Text <textarea data-edit="text">${escapeHtml(selectedItem.text || "")}</textarea></label>` : ""}
      ${isNote ? `<label>Màu note <input type="color" data-edit="color" value="${selectedItem.color || "#d8bd8d"}" /></label>` : ""}
      <label>X <input type="number" data-edit="x" value="${selectedItem.x}" /></label>
      <label>Y <input type="number" data-edit="y" value="${selectedItem.y}" /></label>
      <label>Rộng <input type="number" data-edit="w" value="${selectedItem.w}" /></label>
      <label>Cao <input type="number" data-edit="h" value="${selectedItem.h}" /></label>
      <label>Xoay <input type="number" data-edit="rotation" value="${selectedItem.rotation || 0}" /></label>
      <label>Layer <input type="number" data-edit="z" value="${selectedItem.z || 1}" /></label>
      ${isPhoto ? `<label>Thay ảnh <input type="file" accept="image/*" data-replace-photo /></label>` : ""}
      ${isPhoto ? `<label>Video cho ảnh <input type="file" accept="video/*" data-video-upload /></label>` : ""}
      ${isPhoto && selectedItem.videoSrc ? `<label>Video hiện tại <input value="${escapeAttr(selectedItem.videoName || "video đã chọn")}" readonly /></label>` : ""}
    </div>
    <div class="selected-actions">
      ${isPhoto ? `<button type="button" data-size-step="-10">Nhỏ -</button>` : ""}
      ${isPhoto ? `<button type="button" data-size-step="10">Lớn +</button>` : ""}
      ${isPhoto ? `<button type="button" data-size-step="reset">Reset size</button>` : ""}
      <button type="button" data-duplicate-item>Nhân bản</button>
      ${isPhoto ? `<button type="button" data-preview-photo>Xem lớn</button>` : ""}
      ${isPhoto && selectedItem.videoSrc ? `<button type="button" data-clear-video>Xóa video</button>` : ""}
      <button type="button" class="danger" data-delete-item>Xóa item</button>
    </div>
  `;

  selectedEditor.querySelectorAll("[data-edit]").forEach((field) => {
    field.addEventListener("input", () => {
      const key = field.dataset.edit;
      selectedItem[key] = field.type === "number" ? Number(field.value) : field.value;
      if (key === "w" || key === "h") {
        selectedItem.baseW = Number(selectedItem.w || 120);
        selectedItem.baseH = Number(selectedItem.h || 140);
        selectedItem.scale = 100;
      }
      renderContent();
      renderBoard();
      renderMediaLibrary();
      saveProject();
    });
  });

  selectedEditor.querySelector("[data-size-scale]")?.addEventListener("input", (event) => {
    setItemScale(selectedItem, event.target.value);
    selectedEditor.querySelector("[data-scale-value]").textContent = `${selectedItem.scale}%`;
    selectedEditor.querySelector('[data-edit="w"]').value = selectedItem.w;
    selectedEditor.querySelector('[data-edit="h"]').value = selectedItem.h;
    renderContent();
    renderBoard();
    renderMediaLibrary();
    saveProject();
  });

  selectedEditor.querySelectorAll("[data-size-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const slider = selectedEditor.querySelector("[data-size-scale]");
      if (!slider) return;
      const nextValue = button.dataset.sizeStep === "reset" ? 100 : Number(slider.value) + Number(button.dataset.sizeStep);
      slider.value = Math.max(35, Math.min(220, nextValue));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  selectedEditor.querySelector("[data-duplicate-item]").addEventListener("click", duplicateSelectedItem);
  selectedEditor.querySelector("[data-preview-photo]")?.addEventListener("click", () => {
    adminPanel.classList.remove("is-open");
    openPhoto(selectedItem);
  });
  selectedEditor.querySelector("[data-delete-item]").addEventListener("click", deleteSelectedItem);
  selectedEditor.querySelector("[data-clear-video]")?.addEventListener("click", () => {
    selectedItem.videoSrc = "";
    selectedItem.videoName = "";
    renderAll();
  });
  selectedEditor.querySelector("[data-replace-photo]")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const media = await fileToMedia(file);
    project.media.push(media);
    selectedItem.mediaId = media.id;
    renderAll();
  });
  selectedEditor.querySelector("[data-video-upload]")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    selectedItem.videoSrc = await fileToDataUrl(file);
    selectedItem.videoName = file.name;
    renderAll();
  });
}

function renderMediaLibrary() {
  if (!isAdminMode || !mediaGrid) return;
  mediaGrid.innerHTML = "";
  project.media.filter((media) => (media.type || "photo") === mediaFilter).forEach((media) => {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<img src="${media.src}" alt="" /><span>${escapeHtml(media.name)}</span>`;
    button.addEventListener("click", () => {
      if (selectedItem?.mediaId) {
        selectedItem.mediaId = media.id;
        renderAll();
      } else if (media.type === "board") {
        project.layers.board.image = media.src;
        renderAll();
      }
    });
    mediaGrid.appendChild(button);
  });
}

function renderPhotoTextTable() {
  if (!isAdminMode || !photoTextTable) return;
  const photos = project.photos
    .filter((photo) => photo.photoNumber && photo.photoNumber <= PHOTO_COUNT)
    .sort((a, b) => a.photoNumber - b.photoNumber);

  photoTextTable.innerHTML = photos.map((photo) => `
    <div class="photo-text-row" data-photo-row="${photo.id}">
      <button type="button" data-select-photo="${photo.id}">#${photo.photoNumber}</button>
      <label>Caption
        <input data-photo-caption="${photo.id}" value="${escapeAttr(photo.caption || "")}" />
      </label>
      <label>Take note
        <textarea data-photo-note="${photo.id}">${escapeHtml(photo.detailNote || "")}</textarea>
      </label>
    </div>
  `).join("");

  photoTextTable.querySelectorAll("[data-select-photo]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedItem = project.photos.find((photo) => photo.id === button.dataset.selectPhoto) || null;
      renderAll();
    });
  });

  photoTextTable.querySelectorAll("[data-photo-caption]").forEach((field) => {
    field.addEventListener("input", () => {
      const photo = project.photos.find((item) => item.id === field.dataset.photoCaption);
      if (!photo) return;
      photo.caption = field.value;
      renderBoard();
      saveProject();
    });
  });

  photoTextTable.querySelectorAll("[data-photo-note]").forEach((field) => {
    field.addEventListener("input", () => {
      const photo = project.photos.find((item) => item.id === field.dataset.photoNote);
      if (!photo) return;
      photo.detailNote = field.value;
      saveProject();
    });
  });
}

function bindAdmin() {
  if (!isAdminMode) return;

  document.addEventListener("keydown", handleEditorShortcut);
  adminToggle.addEventListener("click", () => adminPanel.classList.add("is-open"));
  document.querySelector("[data-admin-close]").addEventListener("click", () => adminPanel.classList.remove("is-open"));

  document.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("is-active", item === tab));
      document.querySelectorAll("[data-section]").forEach((section) => section.classList.toggle("is-active", section.dataset.section === tab.dataset.tab));
      updateDataPreview();
    });
  });

  document.querySelectorAll("[data-field]").forEach((field) => {
    field.addEventListener("input", () => {
      project[field.dataset.field] = field.value;
      renderAll();
    });
  });

  document.querySelector("[data-bg-upload]").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    project.backgroundImage = await fileToDataUrl(file);
    renderAll();
  });

  document.querySelector("[data-media-upload]").addEventListener("change", async (event) => {
    const files = [...(event.target.files ?? [])];
    const mediaItems = await Promise.all(files.map(fileToMedia));
    mediaItems.forEach((item) => item.type = mediaFilter);
    project.media.push(...mediaItems);
    renderAll();
  });

  document.querySelectorAll("[data-media-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      mediaFilter = button.dataset.mediaFilter;
      document.querySelectorAll("[data-media-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderMediaLibrary();
    });
  });

  document.querySelectorAll("[data-layer-upload]").forEach((field) => {
    field.addEventListener("change", (event) => {
      const files = [...(event.target.files ?? [])];
      if (!files.length) return;
      const key = field.dataset.layerUpload;
      pendingLayerFiles.set(key, files);
      const status = document.querySelector(`[data-layer-status="${key}"]`);
      if (status) status.textContent = `Đã chọn ${files.length} ảnh`;
    });
  });

  document.querySelectorAll("[data-layer-apply]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const key = button.dataset.layerApply;
      const files = pendingLayerFiles.get(key);
      const status = document.querySelector(`[data-layer-status="${key}"]`);
      if (!files?.length) {
        if (status) status.textContent = "Chọn ảnh trước rồi Apply";
        return;
      }

      if (key === "background") {
        project.layers.background.image = await fileToDataUrl(files[0]);
        if (Number(project.layers.background.opacity || 0) === 0) project.layers.background.opacity = 1;
      }

      if (key === "board") {
        const media = await fileToMedia(files[0], "board");
        project.media.push(media);
        project.layers.board.image = media.src;
      }

      if (key === "decoration") {
        const mediaItems = await Promise.all(files.map((file) => fileToMedia(file, "decoration")));
        project.media.push(...mediaItems);
        mediaItems.forEach((media, index) => {
          project.decor.push({
            id: uid("decor"),
            type: "image",
            mediaId: media.id,
            x: 120 + index * 18,
            y: 160 + index * 18,
            w: 120,
            h: 120,
            rotation: 0,
            z: 46 + index
          });
        });
      }

      pendingLayerFiles.delete(key);
      if (status) status.textContent = "Đã apply và autosave";
      renderAll();
    });
  });

  document.querySelector("[data-layer-clear='background']").addEventListener("click", () => {
    project.layers.background.image = "";
    project.layers.background.opacity = 0;
    renderAll();
  });

  document.querySelectorAll("[data-layer-field]").forEach((field) => {
    field.addEventListener("input", () => {
      setPath(project.layers, field.dataset.layerField, Number(field.value));
      renderAll();
    });
  });

  document.querySelectorAll("[data-theme-field]").forEach((field) => {
    const handleThemeField = () => {
      const key = field.dataset.themeField;
      const numeric = field.type === "range";
      project.theme[key] = numeric ? Number(field.value) : field.value;

      if (key === "preset") applyPreset(field.value);
      if (key === "corkColor") project.backgroundColor = field.value;
      renderAll();
    };

    field.addEventListener("input", handleThemeField);
    field.addEventListener("change", handleThemeField);
  });

  document.querySelectorAll("[data-theme-upload]").forEach((field) => {
    field.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const key = field.dataset.themeUpload;
      pendingThemeFiles.set(key, file);
      const status = document.querySelector(`[data-theme-status="${key}"]`);
      if (status) status.textContent = `Đã chọn: ${file.name}`;
    });
  });

  document.querySelectorAll("[data-theme-apply]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const key = button.dataset.themeApply;
      const file = pendingThemeFiles.get(key);
      const status = document.querySelector(`[data-theme-status="${key}"]`);

      if (!file) {
        if (status) status.textContent = "Chọn ảnh trước rồi bấm Apply";
        return;
      }

      project.theme[key] = await fileToDataUrl(file);

      if (key === "appBackgroundImage" && Number(project.theme.backgroundOpacity || 0) === 0) {
        project.theme.backgroundOpacity = 0.8;
      }

      if (key === "corkTextureImage" && Number(project.theme.corkTextureOpacity || 0) === 0) {
        project.theme.corkTextureOpacity = 0.75;
      }

      pendingThemeFiles.delete(key);
      if (status) status.textContent = "Đã apply và autosave";
      renderAll();
    });
  });

  const themeSection = document.querySelector('[data-section="theme"]');
  if (themeSection) {
    themeSection.addEventListener("dragover", (event) => {
      event.preventDefault();
      themeSection.classList.add("is-dragging");
    });
    themeSection.addEventListener("dragleave", () => themeSection.classList.remove("is-dragging"));
    themeSection.addEventListener("drop", async (event) => {
      event.preventDefault();
      themeSection.classList.remove("is-dragging");
      const file = event.dataTransfer.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      project.theme.appBackgroundImage = await fileToDataUrl(file);
      if (Number(project.theme.backgroundOpacity || 0) === 0) project.theme.backgroundOpacity = 0.8;
      renderAll();
    });
  }

  document.querySelector("[data-add-photo]").addEventListener("click", addPhoto);
  document.querySelector("[data-add-note]").addEventListener("click", addNote);
  document.querySelector("[data-add-flower]")?.addEventListener("click", () => addDecor("flower"));
  document.querySelector("[data-add-paper]").addEventListener("click", () => addDecor("paper"));
  document.querySelector("[data-export]").addEventListener("click", exportProject);
  document.querySelector("[data-import]").addEventListener("change", importProject);
  document.querySelector("[data-reset-project]").addEventListener("click", () => {
    clearSavedProject().finally(() => location.reload());
  });
}

function applyPreset(name) {
  const preset = themePresets[name];
  if (!preset) return;
  project.theme = {
    ...project.theme,
    preset: name,
    corkColor: preset.backgroundColor,
    frameColor: preset.frameColor,
    lightColor: rgbaToHexish(preset.lightColor) || project.theme.lightColor,
    warmth: preset.warmth,
    brightness: preset.brightness,
    contrast: preset.contrast,
    saturation: preset.saturation,
    decorTone: preset.decorTone || project.theme.decorTone || "flowers"
  };
  project.backgroundColor = preset.backgroundColor;
}

function addPhoto() {
  const media = project.media[0];
  const photo = {
    id: uid("photo"),
    mediaId: media.id,
    crop: "center",
    caption: "caption",
    x: 260,
    y: 260,
    w: 160,
    h: 180,
    rotation: -3,
    z: 30
  };
  project.photos.push(photo);
  selectedItem = photo;
  renderAll();
}

function addNote() {
  const note = {
    id: uid("note"),
    text: "gió chiều",
    x: 220,
    y: 220,
    w: 132,
    h: 100,
    rotation: -2,
    z: 42,
    color: "#d8bd8d"
  };
  project.notes.push(note);
  selectedItem = note;
  renderAll();
}

function addDecor(type) {
  const decor = {
    id: uid(type),
    type,
    x: 300,
    y: 300,
    w: type === "flower" ? 86 : 170,
    h: type === "flower" ? 250 : 100,
    rotation: type === "flower" ? -12 : 4,
    z: type === "flower" ? 45 : 5
  };
  project.decor.push(decor);
  selectedItem = decor;
  renderAll();
}

function deleteSelectedItem() {
  if (!selectedItem) return;
  project.photos = project.photos.filter((item) => item.id !== selectedItem.id);
  project.notes = project.notes.filter((item) => item.id !== selectedItem.id);
  project.decor = project.decor.filter((item) => item.id !== selectedItem.id);
  selectedItem = null;
  renderAll();
}

function duplicateSelectedItem() {
  if (!selectedItem) return;
  const clone = structuredClone(selectedItem);
  const kind = clone.mediaId ? "photo" : "text" in clone ? "note" : "decor";
  clone.id = uid(kind);
  clone.x = Math.round((clone.x || 0) + 26);
  clone.y = Math.round((clone.y || 0) + 26);
  clone.z = Number(clone.z || 1) + 1;

  if (kind === "photo") project.photos.push(clone);
  else if (kind === "note") project.notes.push(clone);
  else project.decor.push(clone);

  selectedItem = clone;
  renderAll();
}

function handleEditorShortcut(event) {
  if (!isAdminMode || !selectedItem) return;
  const tagName = document.activeElement?.tagName?.toLowerCase();
  if (["input", "textarea", "select"].includes(tagName)) return;

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelectedItem();
    return;
  }

  const distance = event.shiftKey ? 10 : 1;
  const moves = {
    ArrowLeft: [-distance, 0],
    ArrowRight: [distance, 0],
    ArrowUp: [0, -distance],
    ArrowDown: [0, distance]
  };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  selectedItem.x = Math.round((selectedItem.x || 0) + move[0]);
  selectedItem.y = Math.round((selectedItem.y || 0) + move[1]);
  renderAll();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function fileToMedia(file, type = "photo") {
  return {
    id: uid("media"),
    name: file.name,
    type,
    src: await fileToDataUrl(file)
  };
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  while (parts.length > 1) cursor = cursor[parts.shift()];
  cursor[parts[0]] = value;
}

function getPath(target, path) {
  return path.split(".").reduce((cursor, key) => cursor?.[key], target);
}

function exportProject() {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "project.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importProject(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  project = JSON.parse(await file.text());
  normalizeProject();
  selectedItem = null;
  renderAll();
}

function setDetailPhotoRatio(width, height) {
  const safeWidth = Math.max(1, Number(width) || 4);
  const safeHeight = Math.max(1, Number(height) || 5);
  const ratio = safeWidth / safeHeight;
  const viewport = window.visualViewport;
  const maxWidth = Math.min((viewport?.width ?? innerWidth) * 0.86, 430);
  const maxHeight = Math.min((viewport?.height ?? innerHeight) * 0.6, 560);
  const frameWidth = Math.max(230, Math.min(maxWidth, maxHeight * ratio));
  detailPhoto.style.setProperty("--detail-ratio", `${Math.round(safeWidth)} / ${Math.round(safeHeight)}`);
  detailPhoto.style.setProperty("--detail-frame-width", `${Math.round(frameWidth)}px`);
}

async function applyOriginalDetailPhotoRatio(photo, media) {
  const image = await loadImageSize(media?.src || "");
  if (!image || !selected || selected.id !== photo.id) return;
  setDetailPhotoRatio(image.width, image.height);
  if (image.src && image.src !== media.src) {
    detailPhoto.style.setProperty("--detail-src", `url("${image.src}")`);
  }
}

function openPhoto(photo) {
  returnViewBeforeFocus = {
    view: { ...view },
    mode
  };
  selected = photo;
  mode = "focus";
  document.body.classList.add("detail-open");
  opened.add(photo.id);
  const media = mediaById(photo.mediaId);
  const imageAreaWidth = Math.max(80, Number(photo.w || 160) - 20);
  const imageAreaHeight = Math.max(80, Number(photo.h || 180) - 59);
  detailPhoto.style.setProperty("--detail-src", imageCssSources(media.src));
  detailPhoto.style.setProperty("--crop", photo.crop || "center");
  setDetailPhotoRatio(imageAreaWidth, imageAreaHeight);
  detailPhoto.style.setProperty("--detail-size", media.src?.startsWith("data:") || media.src?.includes("public/photos/") ? "contain" : "400% 300%");
  applyOriginalDetailPhotoRatio(photo, media);
  detailTitle.textContent = photo.caption || "";
  detailNote.textContent = photo.detailNote || "";
  detailDate.textContent = "memory";
  detailVideo.removeAttribute("src");
  detailVideo.load();
  detail.classList.remove("has-video");
  activeDetailVideoSrc = "";
  detailVideoPlay.hidden = true;
  detailVideoPlay.disabled = true;
  prepareDetailVideo(photo, media);
  detail.classList.add("open");
  renderBoardTransform();
}

function stopDetailVideo() {
  document.body.classList.remove("detail-open");
  activeDetailVideoSrc = "";
  detailVideoPlay.hidden = true;
  detailVideoPlay.disabled = true;
  if (!detailVideo) return;
  detailVideo.pause();
  detailVideo.removeAttribute("src");
  detailVideo.removeAttribute("style");
  detailVideo.load();
  detail.classList.remove("has-video");
  resumeBackgroundMusicAfterVideo();
}

function closeDetail({ restoreView = true } = {}) {
  selected = null;
  stopDetailVideo();
  detail.classList.remove("open");

  if (restoreView && returnViewBeforeFocus) {
    view = { ...returnViewBeforeFocus.view };
    mode = "manual";
    returnViewBeforeFocus = null;
    applyView();
    return;
  }

  returnViewBeforeFocus = null;
  mode = "entry";
  renderBoardTransform();
}

async function setupAudioPlaylist() {
  if (!audio) return;
  audio.loop = false;
  try {
    const playlistUrl = hasCmsServer() ? "/api/audio-list" : "public/audio/playlist.json";
    const response = await fetch(playlistUrl, { cache: "no-store" });
    const data = response.ok ? await response.json() : null;
    audioPlaylist = Array.isArray(data?.tracks) ? data.tracks : [];
  } catch {
    audioPlaylist = [];
  }

  if (!audioPlaylist.length && audio.getAttribute("src")) {
    audioPlaylist = [{ name: "Đi Đến Nơi Có Gió OST", src: audio.getAttribute("src") }];
  }

  const currentSrc = audio.getAttribute("src");
  const currentIndex = audioPlaylist.findIndex((track) => currentSrc && track.src === currentSrc);
  currentAudioIndex = currentIndex >= 0 ? currentIndex : 0;
  setAudioTrack(currentAudioIndex, false);

  audio.addEventListener("ended", playNextAudioTrack);
  audio.addEventListener("play", () => updateMusicUi(true));
  audio.addEventListener("pause", () => {
    if (!shouldResumeMusicAfterVideo) updateMusicUi(false);
  });
}

function setAudioTrack(index, autoplay) {
  if (!audioPlaylist.length || !audio) return;
  currentAudioIndex = ((index % audioPlaylist.length) + audioPlaylist.length) % audioPlaylist.length;
  const track = audioPlaylist[currentAudioIndex];
  if (audio.getAttribute("src") !== track.src) audio.src = track.src;
  musicButton.querySelector("b").textContent = track.name || "playlist";
  musicStatus.textContent = audioPlaylist.length > 1 ? `${currentAudioIndex + 1}/${audioPlaylist.length}` : "tap để phát nền";
  if (autoplay) playBackgroundMusic();
}

function playNextAudioTrack() {
  if (!audioPlaylist.length) return;
  setAudioTrack(currentAudioIndex + 1, backgroundMusicDesired);
}

async function playBackgroundMusic() {
  if (!audio) return;
  backgroundMusicDesired = true;
  try {
    applyBackgroundMusicVolume();
    await audio.play();
    updateMusicUi(true);
  } catch {
    musicStatus.textContent = "tap để phát nền";
  }
}

function pauseBackgroundMusic({ userRequested = false } = {}) {
  if (!audio) return;
  if (userRequested) backgroundMusicDesired = false;
  audio.pause();
  updateMusicUi(false);
}

function backgroundMusicVolume() {
  return BACKGROUND_MUSIC_VOLUME * (isMusicDuckedForVideo ? VIDEO_DUCK_GAIN : 1);
}

function applyBackgroundMusicVolume() {
  if (!audio) return;
  audio.volume = Math.max(0, Math.min(1, backgroundMusicVolume()));
}

async function duckBackgroundMusicForVideo() {
  if (!audio || !backgroundMusicDesired) return;
  isMusicDuckedForVideo = true;
  applyBackgroundMusicVolume();
  if (audio.paused) {
    await playBackgroundMusic();
  } else {
    updateMusicUi(true);
  }
}

function restoreBackgroundMusicAfterVideo() {
  if (!isMusicDuckedForVideo) return;
  isMusicDuckedForVideo = false;
  applyBackgroundMusicVolume();
  updateMusicUi(backgroundMusicDesired && !audio?.paused);
}

function updateMusicUi(isPlaying) {
  musicButton.classList.toggle("playing", isPlaying);
  musicButton.querySelector(".music-player__play").textContent = isPlaying ? "Ⅱ" : "▶";
  if (isPlaying) {
    const track = audioPlaylist[currentAudioIndex];
    const duckLabel = isMusicDuckedForVideo ? " · -5 dB" : "";
    musicStatus.textContent = audioPlaylist.length > 1 ? `đang phát ${currentAudioIndex + 1}/${audioPlaylist.length}${duckLabel}` : `đang phát nền${duckLabel}`;
    if (track?.name) musicButton.querySelector("b").textContent = track.name;
  } else if (backgroundMusicDesired && shouldResumeMusicAfterVideo) {
    musicStatus.textContent = "đang giữ nhạc nền";
  } else {
    musicStatus.textContent = audioPlaylist.length > 1 ? `playlist ${audioPlaylist.length} bài` : "tap để phát nền";
  }
}

async function resumeBackgroundMusicAfterVideo() {
  restoreBackgroundMusicAfterVideo();
  if (!shouldResumeMusicAfterVideo) return;
  shouldResumeMusicAfterVideo = false;
  if (backgroundMusicDesired) await playBackgroundMusic();
}

function sizeDetailVideoToMetadata() {
  const videoWidth = detailVideo.videoWidth || 16;
  const videoHeight = detailVideo.videoHeight || 9;
  const maxWidth = Math.min(innerWidth * 0.88, 430);
  const maxHeight = Math.min((window.visualViewport?.height ?? innerHeight) * 0.58, 520);
  const ratio = videoWidth / videoHeight;
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  detailVideo.style.width = `${Math.round(width)}px`;
  detailVideo.style.height = `${Math.round(height)}px`;
}

function overviewScale() {
  if (!project?.board) return 0.42;
  const viewport = window.visualViewport;
  const width = viewport?.width ?? innerWidth;
  const height = viewport?.height ?? innerHeight;
  const horizontal = (width - 24) / project.board.width;
  const vertical = (height - 104) / project.board.height;
  return Math.min(0.74, Math.max(0.22, Math.min(horizontal, vertical)));
}

function entryScale() {
  if (!project?.board) return 0.72;
  const viewport = window.visualViewport;
  const width = viewport?.width ?? innerWidth;
  const height = viewport?.height ?? innerHeight;
  return Math.min(0.92, Math.max(0.42, Math.min((width - 24) / 720, (height - 118) / 880)));
}

function setViewToFocus(focus, scale) {
  view.scale = scale;
  view.x = -((focus.x - project.board.width / 2) * scale);
  view.y = -((focus.y - project.board.height / 2) * scale);
}

function applyView({ focused = false } = {}) {
  board.classList.toggle("focused", focused);
  board.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function beginViewerGesture(event) {
  if (isAdminMode || selected) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  mode = "manual";
  gestureMoved = false;

  if (pointers.size === 1) {
    panStart = { pointer: { x: event.clientX, y: event.clientY }, view: { ...view } };
  }

  if (pointers.size === 2) {
    const values = [...pointers.values()];
    pinchStart = {
      distance: Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y),
      view: { ...view },
      center: { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 }
    };
    gestureMoved = true;
  }
}

function updateViewerGesture(event) {
  if (!pointers.has(event.pointerId) || isAdminMode) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (pointers.size === 2 && pinchStart) {
    const values = [...pointers.values()];
    const nextScale = clamp(
      pinchStart.view.scale * (Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y) / pinchStart.distance),
      overviewScale() * 0.84,
      1.55
    );
    const ratio = nextScale / pinchStart.view.scale;
    view.scale = nextScale;
    view.x = pinchStart.center.x - innerWidth / 2 - (pinchStart.center.x - innerWidth / 2 - pinchStart.view.x) * ratio;
    view.y = pinchStart.center.y - innerHeight / 2 - (pinchStart.center.y - innerHeight / 2 - pinchStart.view.y) * ratio;
    gestureMoved = true;
    applyView();
    return;
  }

  if (pointers.size === 1 && panStart) {
    const moved = Math.hypot(event.clientX - panStart.pointer.x, event.clientY - panStart.pointer.y);
    if (moved > 8) gestureMoved = true;
    view.x = panStart.view.x + event.clientX - panStart.pointer.x;
    view.y = panStart.view.y + event.clientY - panStart.pointer.y;
    applyView();
  }
}

function endViewerGesture(event) {
  if (tapState?.pointerId === event.pointerId) tapState = null;
  pointers.delete(event.pointerId);
  panStart = null;
  pinchStart = null;
}

function renderBoardTransform() {
  if (!project?.board) return;
  if (mode === "manual") {
    applyView();
    return;
  }

  if (!selected) {
    if (mode === "fit") {
      view.scale = overviewScale();
      view.x = 0;
      view.y = 0;
    } else {
      setViewToFocus({ x: project.board.width / 2, y: 560 }, entryScale());
    }
    applyView();
    return;
  }

  const scale = Math.min(1.36, Math.max(0.95, overviewScale() * 3.1));
  setViewToFocus({ x: selected.x + selected.w / 2, y: selected.y + selected.h / 2 + 16 }, scale);
  applyView({ focused: true });
}

board.addEventListener("pointerdown", (event) => {
  if (isAdminMode || selected) return;
  board.setPointerCapture(event.pointerId);
  beginViewerGesture(event);
});

board.addEventListener("pointermove", (event) => {
  updateViewerGesture(event);
});

board.addEventListener("pointerup", endViewerGesture);
board.addEventListener("pointercancel", endViewerGesture);

document.querySelector("[data-close]").addEventListener("click", () => {
  closeDetail();
});

document.querySelector("[data-fit]").addEventListener("click", () => {
  selected = null;
  mode = "fit";
  endingCopy.classList.remove("show");
  stopDetailVideo();
  detail.classList.remove("open");
  returnViewBeforeFocus = null;
  renderBoardTransform();
});

detail.addEventListener("click", (event) => {
  if (event.target === detail) {
    closeDetail();
  }
});

detailVideoPlay.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (!activeDetailVideoSrc) return;
  shouldResumeMusicAfterVideo = false;
  await duckBackgroundMusicForVideo();
  detailVideo.src = activeDetailVideoSrc;
  detail.classList.add("has-video");
  detailVideoPlay.hidden = true;
  try {
    await detailVideo.play();
  } catch {
    restoreBackgroundMusicAfterVideo();
    detailVideo.controls = true;
  }
});

detailVideo.addEventListener("loadedmetadata", sizeDetailVideoToMetadata);
detailVideo.addEventListener("play", () => {
  duckBackgroundMusicForVideo();
});
detailVideo.addEventListener("ended", resumeBackgroundMusicAfterVideo);
detailVideo.addEventListener("pause", () => {
  if (detail.classList.contains("has-video") && !detailVideo.ended) resumeBackgroundMusicAfterVideo();
});

viewAll.addEventListener("click", () => {
  selected = null;
  mode = "fit";
  stopDetailVideo();
  detail.classList.remove("open");
  returnViewBeforeFocus = null;
  view.scale = overviewScale() * 0.9;
  view.x = 0;
  view.y = 0;
  applyView();
  endingCopy.classList.add("show");
});

musicButton.addEventListener("click", async () => {
  if (!audio) return;
  if (!audio.paused) {
    pauseBackgroundMusic({ userRequested: true });
    return;
  }

  await playBackgroundMusic();
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function hexToRgba(hex, alpha = 1) {
  if (!hex || !hex.startsWith("#")) return hex || `rgba(255, 235, 175, ${alpha})`;
  const clean = hex.slice(1);
  const value = clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean;
  const number = parseInt(value, 16);
  const r = (number >> 16) & 255;
  const g = (number >> 8) & 255;
  const b = number & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rgbaToHexish(value) {
  const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return "";
  return `#${[match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

addEventListener("resize", renderBoardTransform);
window.visualViewport?.addEventListener("resize", renderBoardTransform);
init();
