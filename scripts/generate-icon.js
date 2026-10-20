/**
 * MiMo 图标生成脚本 - 简化版本
 * 生成带渐变背景和 M 字母的 PNG 图标
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 计算
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 创建 PNG chunk
function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crcValue = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crcValue, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// 判断点是否在圆角矩形内
function insideRoundedRect(x, y, size, radius) {
  if (x < 0 || x >= size || y < 0 || y >= size) return false;
  
  // 检查四个角
  const corners = [
    { cx: radius - 0.5, cy: radius - 0.5 },                    // 左上
    { cx: size - radius - 0.5, cy: radius - 0.5 },             // 右上
    { cx: radius - 0.5, cy: size - radius - 0.5 },             // 左下
    { cx: size - radius - 0.5, cy: size - radius - 0.5 }       // 右下
  ];
  
  // 判断是否在某个圆角区域内（在圆角范围内但不在方形区域内）
  for (const c of corners) {
    const dx = x - c.cx;
    const dy = y - c.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // 如果在圆角范围内，必须在圆形内
    if (dist <= radius) return true;
    // 如果在圆角范围外，检查是否在方形区域内
  }
  
  // 如果不在任何圆角内，检查是否在方形区域内
  // 但我们已经排除了边界情况，这里应该总是在方形内
  return true;
}

// 线性渐变（左上到右下）
function getGradientColor(x, y, size) {
  const t = (x + y) / (2 * size);
  // #667EEA -> #764BA2
  const r = Math.round(0x66 + (0x76 - 0x66) * t);
  const g = Math.round(0x7E + (0x4B - 0x7E) * t);
  const b = Math.round(0xEA + (0xA2 - 0xEA) * t);
  return [r, g, b];
}

// 绘制 M 字母
function drawM(x, y, size) {
  const s = size;
  const mTop = Math.floor(s * 0.22);
  const mBottom = Math.floor(s * 0.78);
  const mLeft = Math.floor(s * 0.26);
  const mRight = Math.floor(s * 0.74);
  const thickness = Math.max(3, Math.floor(s * 0.06));
  const centerX = Math.floor(s / 2);
  
  // 左侧竖线
  if (x >= mLeft && x <= mLeft + thickness && y >= mTop && y <= mBottom) {
    return true;
  }
  
  // 右侧竖线
  if (x >= mRight - thickness && x <= mRight && y >= mTop && y <= mBottom) {
    return true;
  }
  
  // V 形交叉线（从竖线顶部向内延伸到中心下方）
  const vTop = mTop + Math.floor(s * 0.12);
  const vBottom = Math.floor((mTop + mBottom) / 2);
  
  if (y >= vTop && y <= vBottom) {
    const progress = (y - vTop) / Math.max(1, (vBottom - vTop));
    // 左侧斜线：从 mLeft + thickness/2 到 centerX
    const leftX = mLeft + thickness / 2 + progress * (centerX - mLeft - thickness / 2);
    // 右侧斜线：从 mCenter 到 mRight - thickness/2
    const rightX = centerX + progress * (mRight - thickness / 2 - centerX);
    
    if (Math.abs(x - leftX) <= thickness / 2) return true;
    if (Math.abs(x - rightX) <= thickness / 2) return true;
  }
  
  // 底部圆点
  const dotY = mBottom + Math.floor(s * 0.04);
  const dotR = Math.floor(s * 0.035);
  const dist = Math.sqrt((x - centerX) ** 2 + (y - dotY) ** 2);
  if (dist <= dotR) return true;
  
  return false;
}

// 创建 PNG 数据
function createMimoPng() {
  const size = 256;
  const radius = Math.floor(size * 0.2);
  
  // 分配像素缓冲区
  const pixels = Buffer.alloc(size * size * 4);
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      
      if (!insideRoundedRect(x, y, size, radius)) {
        // 圆角外透明
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
      } else if (drawM(x, y, size)) {
        // M 字母 - 白色
        pixels[idx] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
        pixels[idx + 3] = 255;
      } else {
        // 渐变背景
        const [r, g, b] = getGradientColor(x, y, size);
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
      }
    }
  }
  
  // 构建 PNG 文件
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 6;   // color type (RGBA)
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);
  
  // IDAT chunk - 压缩像素数据
  const rawData = Buffer.alloc((size * 4 + 1) * size);
  for (let row = 0; row < size; row++) {
    rawData[row * (size * 4 + 1)] = 0; // filter byte: None
    const srcStart = row * size * 4;
    const destStart = row * (size * 4 + 1) + 1;
    pixels.copy(rawData, destStart, srcStart, srcStart + size * 4);
  }
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  
  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// 生成并保存
console.log('[MiMo] 开始生成图标...');
const png = createMimoPng();
const outputDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
const outputPath = path.join(outputDir, 'icon.png');
fs.writeFileSync(outputPath, png);
console.log(`[MiMo] 图标已生成: ${outputPath}`);
console.log(`[MiMo] 文件大小: ${png.length} bytes`);
console.log(`[MiMo] PNG 头部: ${png.slice(0, 8).toString('hex')}`);
