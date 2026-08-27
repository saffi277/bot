'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';

type Controls = {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  scale: number;
};

const initialControls: Controls = {
  brightness: 100,
  contrast: 105,
  saturation: 105,
  sharpen: 0.35,
  scale: 1,
};

const controlsMeta: Array<{
  key: Exclude<keyof Controls, 'scale'>;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
}> = [
  { key: 'brightness', label: 'الإضاءة', min: 60, max: 145, step: 1, suffix: '%' },
  { key: 'contrast', label: 'التباين', min: 60, max: 150, step: 1, suffix: '%' },
  { key: 'saturation', label: 'الألوان', min: 0, max: 170, step: 1, suffix: '%' },
  { key: 'sharpen', label: 'الوضوح', min: 0, max: 1, step: 0.05, suffix: '' },
];

function drawProcessedImage(image: HTMLImageElement, canvas: HTMLCanvasElement, controls: Controls) {
  const maxDimension = 2600;
  const naturalScale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const outputScale = naturalScale * controls.scale;
  const width = Math.max(1, Math.round(image.naturalWidth * outputScale));
  const height = Math.max(1, Math.round(image.naturalHeight * outputScale));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: controls.sharpen > 0 });
  if (!context) return;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = `brightness(${controls.brightness}%) contrast(${controls.contrast}%) saturate(${controls.saturation}%)`;
  context.drawImage(image, 0, 0, width, height);
  context.filter = 'none';
  if (controls.sharpen <= 0) return;

  const source = context.getImageData(0, 0, width, height);
  const result = context.createImageData(width, height);
  const amount = controls.sharpen;
  const pixels = source.data;
  const output = result.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        output[pixel] = pixels[pixel]; output[pixel + 1] = pixels[pixel + 1]; output[pixel + 2] = pixels[pixel + 2]; output[pixel + 3] = pixels[pixel + 3];
        continue;
      }
      const top = pixel - width * 4;
      const bottom = pixel + width * 4;
      const left = pixel - 4;
      const right = pixel + 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = pixels[pixel + channel];
        const neighbours = pixels[top + channel] + pixels[bottom + channel] + pixels[left + channel] + pixels[right + channel];
        output[pixel + channel] = Math.max(0, Math.min(255, center * (1 + 4 * amount) - neighbours * amount));
      }
      output[pixel + 3] = pixels[pixel + 3];
    }
  }
  context.putImageData(result, 0, 0);
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [controls, setControls] = useState<Controls>(initialControls);
  const [isProcessing, setIsProcessing] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (resultUrl) URL.revokeObjectURL(resultUrl); }, [sourceUrl, resultUrl]);

  const processFile = (nextFile: File, nextControls: Controls) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsProcessing(true); setNotice('جارٍ تحسين الصورة…');
    const image = new Image();
    image.onload = () => {
      drawProcessedImage(image, canvas, nextControls);
      canvas.toBlob((blob) => {
        if (blob) setResultUrl((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(blob); });
        setNotice(blob ? 'جاهزة للتنزيل' : 'تعذر تجهيز النتيجة.'); setIsProcessing(false);
      }, 'image/jpeg', 0.94);
    };
    image.onerror = () => { setNotice('تعذر قراءة هذه الصورة. جرّب JPG أو PNG أو WebP.'); setIsProcessing(false); };
    image.src = URL.createObjectURL(nextFile);
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!selected.type.startsWith('image/')) { setNotice('يرجى اختيار صورة فقط.'); return; }
    if (selected.size > 15 * 1024 * 1024) { setNotice('للنسخة الأولى، الحد الأقصى للصورة هو 15MB.'); return; }
    setSourceUrl((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(selected); });
    setFile(selected); processFile(selected, controls);
  };

  const updateControl = (key: Exclude<keyof Controls, 'scale'>, value: number) => {
    const nextControls = { ...controls, [key]: value }; setControls(nextControls); if (file) processFile(file, nextControls);
  };
  const downloadImage = () => {
    if (!resultUrl) return;
    const link = document.createElement('a'); link.href = resultUrl; link.download = `bot-enhanced-${file?.name.replace(/\.[^/.]+$/, '') || 'image'}.jpg`; link.click();
  };

  return (
    <main dir="rtl">
      <canvas ref={canvasRef} className="sr-only" aria-hidden="true" />
      <section className="hero-shell">
        <nav className="nav-wrap" aria-label="التنقل الرئيسي">
          <a className="brand" href="#top" aria-label="Bot الصفحة الرئيسية"><span className="brand-mark">b</span><span>bot<span className="brand-dot">.</span></span></a>
          <div className="nav-actions"><a className="text-link" href="#how-it-works">كيف يعمل</a><button className="telegram-button" type="button" onClick={() => setNotice('سيتم ربط هذا الزر ببوت تلغرام عند إضافة الرمز الخاص به.')}>تيليغرام ↗</button></div>
        </nav>
        <div className="hero-grid" id="top">
          <div className="hero-copy"><p className="eyebrow">معالجة صور واضحة، بدون ذكاء اصطناعي</p><h1>خلّي صورتك <em>أنظف</em><br />وبالطريقة اللي تحبها.</h1><p className="hero-description">أداة خفيفة لتحسين الإضاءة، الألوان، التباين والوضوح. جرّبها الآن بدون تسجيل وبدون رفع صورتك إلى خادم.</p><div className="hero-points"><span>✓ معالجة مباشرة في المتصفح</span><span>✓ JPG · PNG · WebP</span></div></div>
          <div className="editor-card" aria-live="polite">
            <div className="card-header"><div><p className="card-kicker">أداة التحسين</p><h2>{file ? file.name : 'ارفع صورة للبدء'}</h2></div><span className="status-pill">نسخة تجريبية</span></div>
            {!sourceUrl ? (
              <button className="upload-area" type="button" onClick={() => inputRef.current?.click()}><span className="upload-icon">＋</span><strong>اسحب الصورة هنا أو اخترها من جهازك</strong><small>الحد الأقصى 15MB</small></button>
            ) : (
              <div className="image-workspace"><div className="image-frame">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={resultUrl || sourceUrl} alt="معاينة الصورة بعد المعالجة" />{isProcessing && <div className="processing-overlay">جارٍ المعالجة…</div>}</div><div className="workspace-actions"><button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>تبديل الصورة</button><button className="download-button" type="button" disabled={!resultUrl || isProcessing} onClick={downloadImage}>تنزيل JPG ↓</button></div></div>
            )}
            <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} />
            <div className="controls-section"><div className="controls-title"><span>ضبط النتيجة</span><button type="button" onClick={() => { setControls(initialControls); if (file) processFile(file, initialControls); }}>إعادة ضبط</button></div><div className="sliders">{controlsMeta.map((control) => (<label key={control.key}><span><b>{control.label}</b><output>{control.key === 'sharpen' ? Math.round(controls[control.key] * 100) : controls[control.key]}{control.suffix}</output></span><input type="range" min={control.min} max={control.max} step={control.step} value={controls[control.key]} onChange={(event) => updateControl(control.key, Number(event.target.value))} /></label>))}<label><span><b>الحجم</b><output>{controls.scale}×</output></span><select value={controls.scale} onChange={(event) => { const nextControls = { ...controls, scale: Number(event.target.value) }; setControls(nextControls); if (file) processFile(file, nextControls); }}><option value="1">الحجم الأصلي</option><option value="1.5">تكبير 1.5×</option><option value="2">تكبير 2×</option></select></label></div><p className="privacy-note">{notice || 'التكبير هنا تقليدي، لا يضيف تفاصيل غير موجودة في الصورة.'}</p></div>
          </div>
        </div>
      </section>
      <section className="steps-section" id="how-it-works"><p className="eyebrow">سريع وواضح</p><h2>ثلاث خطوات، والنتيجة عندك.</h2><div className="steps-grid"><article><span>01</span><h3>اختر صورتك</h3><p>ارفع JPG أو PNG أو WebP من الموبايل أو الكمبيوتر.</p></article><article><span>02</span><h3>اضبطها بطريقتك</h3><p>تحكّم بالإضاءة والألوان والتباين والوضوح بشكل مباشر.</p></article><article><span>03</span><h3>نزّلها فوراً</h3><p>احفظ نسخة JPG محسّنة، بدون علامة مائية في النسخة التجريبية.</p></article></div></section>
    </main>
  );
}
