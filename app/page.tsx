'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';

type Controls = { brightness: number; contrast: number; saturation: number; sharpen: number; scale: number };
type Preset = { name: string; values: Controls };

const defaultControls: Controls = { brightness: 100, contrast: 105, saturation: 105, sharpen: 0.25, scale: 1 };
const presets: Preset[] = [
  { name: 'طبيعي', values: defaultControls },
  { name: 'مضيء', values: { brightness: 116, contrast: 108, saturation: 106, sharpen: 0.3, scale: 1 } },
  { name: 'ألوان قوية', values: { brightness: 104, contrast: 118, saturation: 128, sharpen: 0.35, scale: 1 } },
];

const fields: Array<{ key: Exclude<keyof Controls, 'scale'>; label: string; min: number; max: number; step: number; suffix: string }> = [
  { key: 'brightness', label: 'الإضاءة', min: 55, max: 145, step: 1, suffix: '%' },
  { key: 'contrast', label: 'التباين', min: 65, max: 150, step: 1, suffix: '%' },
  { key: 'saturation', label: 'الألوان', min: 0, max: 170, step: 1, suffix: '%' },
  { key: 'sharpen', label: 'الوضوح', min: 0, max: 1, step: 0.05, suffix: '' },
];

function renderImage(image: HTMLImageElement, canvas: HTMLCanvasElement, controls: Controls) {
  const maximum = 2600;
  const fitScale = Math.min(1, maximum / (Math.max(image.naturalWidth, image.naturalHeight) * controls.scale));
  const width = Math.max(1, Math.round(image.naturalWidth * fitScale * controls.scale));
  const height = Math.max(1, Math.round(image.naturalHeight * fitScale * controls.scale));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: controls.sharpen > 0 });
  if (!context) return;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = `brightness(${controls.brightness}%) contrast(${controls.contrast}%) saturate(${controls.saturation}%)`;
  context.drawImage(image, 0, 0, width, height);
  context.filter = 'none';
  if (controls.sharpen === 0) return;

  const source = context.getImageData(0, 0, width, height);
  const destination = context.createImageData(width, height);
  const amount = controls.sharpen;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        destination.data.set(source.data.subarray(index, index + 4), index);
        continue;
      }
      const top = index - width * 4;
      const bottom = index + width * 4;
      const left = index - 4;
      const right = index + 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = source.data[index + channel];
        const nearby = source.data[top + channel] + source.data[bottom + channel] + source.data[left + channel] + source.data[right + channel];
        destination.data[index + channel] = Math.max(0, Math.min(255, center * (1 + 4 * amount) - nearby * amount));
      }
      destination.data[index + 3] = source.data[index + 3];
    }
  }
  context.putImageData(destination, 0, 0);
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const job = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [controls, setControls] = useState<Controls>(defaultControls);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('الصورة لا تغادر جهازك في هذه النسخة.');

  useEffect(() => () => { if (originalUrl) URL.revokeObjectURL(originalUrl); if (processedUrl) URL.revokeObjectURL(processedUrl); }, [originalUrl, processedUrl]);

  const process = (nextFile: File, nextControls: Controls) => {
    const output = canvas.current;
    if (!output) return;
    const currentJob = ++job.current;
    setBusy(true);
    setMessage('جارٍ تجهيز النتيجة…');
    const imageUrl = URL.createObjectURL(nextFile);
    const image = new Image();
    image.onload = () => {
      if (currentJob !== job.current) { URL.revokeObjectURL(imageUrl); return; }
      renderImage(image, output, nextControls);
      URL.revokeObjectURL(imageUrl);
      output.toBlob((blob) => {
        if (currentJob !== job.current) return;
        if (blob) {
          setProcessedUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(blob); });
          setMessage('النتيجة جاهزة للتنزيل.');
        } else setMessage('تعذر تجهيز الصورة. جرّب صورة أخرى.');
        setBusy(false);
      }, 'image/jpeg', 0.94);
    };
    image.onerror = () => { URL.revokeObjectURL(imageUrl); if (currentJob === job.current) { setBusy(false); setMessage('ندعم JPG وPNG وWebP فقط.'); } };
    image.src = imageUrl;
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    if (!nextFile.type.startsWith('image/')) { setMessage('اختر صورة فقط.'); return; }
    if (nextFile.size > 15 * 1024 * 1024) { setMessage('حجم الصورة يجب أن يكون أقل من 15MB.'); return; }
    setOriginalUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(nextFile); });
    setFile(nextFile);
    process(nextFile, controls);
  };

  const update = (key: Exclude<keyof Controls, 'scale'>, value: number) => {
    const next = { ...controls, [key]: value };
    setControls(next);
    if (file) process(file, next);
  };
  const applyPreset = (preset: Preset) => { setControls(preset.values); if (file) process(file, preset.values); };
  const download = () => {
    if (!processedUrl) return;
    const link = document.createElement('a');
    link.href = processedUrl;
    link.download = `bot-${file?.name.replace(/\.[^/.]+$/, '') || 'photo'}.jpg`;
    link.click();
  };

  return (
    <main>
      <canvas ref={canvas} className="visually-hidden" aria-hidden="true" />
      <section className="top-section" id="top">
        <nav className="navigation" aria-label="التنقل">
          <a className="logo" href="#top"><span className="logo-mark">b</span><span>bot<span>.</span></span></a>
          <div className="navigation-links"><a href="#benefits">المميزات</a><a href="#how">كيف يعمل</a><a className="nav-cta" href="#editor">ابدأ الآن <b>←</b></a></div>
        </nav>

        <div className="hero-layout">
          <div className="hero-content">
            <div className="live-label"><i /> متاح الآن · بدون تسجيل</div>
            <p className="section-label">محرر صور خاص وسريع</p>
            <h1>صوّرك أوضح.<br /><em>بطريقتك.</em></h1>
            <p className="hero-text">حسّن الإضاءة والألوان والحدة خلال ثوانٍ. أداة بسيطة ومهنية، تعمل في المتصفح وتحافظ على خصوصية صورتك.</p>
            <div className="hero-actions"><a className="primary-action" href="#editor">عدّل صورة الآن <span>↓</span></a><a className="quiet-action" href="#how">شوف كيف تعمل <span>←</span></a></div>
            <div className="trust-row"><span><b>01</b> بدون اشتراك</span><span><b>02</b> لا علامة مائية</span><span><b>03</b> خصوصية كاملة</span></div>
          </div>
          <aside className="hero-panel" aria-label="ملخص خدمة Bot">
            <div className="panel-top"><span>BOT STUDIO</span><b>● مباشر</b></div>
            <div className="panel-art"><div className="art-grid"><i /><i /><i /><i /><i /><i /></div><div className="art-focus" /></div>
            <div className="panel-metrics"><div><span>التحسين</span><strong>٤ أدوات</strong></div><div><span>المعالجة</span><strong>محلية</strong></div></div>
            <p>أنت المتحكّم بالنتيجة، وليس فلترًا غامضًا.</p>
          </aside>
        </div>
      </section>

      <section className="studio-section" id="editor">
        <div className="studio-heading"><div><p className="section-label">مساحة العمل</p><h2>عدّل الصورة، ثم نزّلها.</h2></div><p>اختَر صورة وجرّب أحد الإعدادات الجاهزة أو اضبط كل شيء بنفسك.</p></div>
        <div className="studio-shell">
          <aside className="control-panel">
            <div className="workspace-title"><span className="number-badge">01</span><div><b>إعدادات التحسين</b><small>تظهر النتيجة فوراً</small></div></div>
            <div className="preset-group"><span className="small-title">إعداد سريع</span><div>{presets.map((preset) => <button key={preset.name} type="button" onClick={() => applyPreset(preset)}>{preset.name}</button>)}</div></div>
            <div className="adjustment-group"><span className="small-title">ضبط يدوي</span>{fields.map((field) => <label key={field.key}><span><b>{field.label}</b><output>{field.key === 'sharpen' ? Math.round(controls[field.key] * 100) : controls[field.key]}{field.suffix}</output></span><input type="range" min={field.min} max={field.max} step={field.step} value={controls[field.key]} onChange={(event) => update(field.key, Number(event.target.value))} /></label>)}</div>
            <label className="scale-select"><span><b>الحجم النهائي</b><output>{controls.scale}×</output></span><select value={controls.scale} onChange={(event) => { const next = { ...controls, scale: Number(event.target.value) }; setControls(next); if (file) process(file, next); }}><option value="1">الحجم الأصلي</option><option value="1.5">تكبير 1.5×</option><option value="2">تكبير 2×</option></select></label>
            <button className="reset-button" type="button" onClick={() => applyPreset(presets[0])}>إعادة كل الإعدادات</button>
          </aside>

          <div className="preview-panel">
            <div className="preview-header"><div><span className="small-title">المعاينة</span><strong>{file?.name || 'ماكو صورة مختارة'}</strong></div><span className={busy ? 'processing-state active' : 'processing-state'}>{busy ? 'جارٍ المعالجة' : processedUrl ? 'جاهزة' : 'بانتظار الصورة'}</span></div>
            {!originalUrl ? (
              <button className="drop-zone" type="button" onClick={() => fileInput.current?.click()}><span className="drop-icon">↥</span><strong>ارفع صورة حتى نبدأ</strong><small>JPG · PNG · WebP · حتى 15MB</small><span className="choose-file">اختيار صورة</span></button>
            ) : (
              <div className="result-area"><div className="image-stage"><img src={processedUrl || originalUrl} alt="الصورة بعد التحسين" />{busy && <div className="working-overlay">نعالج الصورة…</div>}</div><div className="result-actions"><button type="button" className="replace-button" onClick={() => fileInput.current?.click()}>تبديل الصورة</button><button type="button" className="save-button" disabled={!processedUrl || busy} onClick={download}>تنزيل النتيجة <span>↓</span></button></div></div>
            )}
            <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} />
            <p className="workspace-note"><span>⌁</span>{message}</p>
          </div>
        </div>
      </section>

      <section className="benefits-section" id="benefits"><div className="benefit-heading"><p className="section-label">مصمم حتى يكون سهل</p><h2>تحسين حقيقي،<br />بدون تعقيد.</h2></div><div className="benefits-list"><article><span>01</span><h3>النتيجة تحت سيطرتك</h3><p>بدل فلتر واحد، اضبط الإضاءة والتباين والألوان والوضوح بدقة.</p></article><article><span>02</span><h3>صورتك تبقى عندك</h3><p>المعالجة تتم في المتصفح، لذلك الصورة لا تنتقل لخادمنا في هذه المرحلة.</p></article><article><span>03</span><h3>جاهز من تلغرام</h3><p>بوت تلغرام يعرّف بالخدمة ويفتح لك المحرر مباشرة من المحادثة.</p></article></div></section>

      <section className="how-section" id="how"><div><p className="section-label">ثلاث خطوات فقط</p><h2>من صورة عادية<br />إلى نسخة مرتبة.</h2></div><ol><li><b>١</b><div><strong>ارفع الصورة</strong><span>اختَرها من موبايلك أو جهازك.</span></div></li><li><b>٢</b><div><strong>اضبطها بطريقتك</strong><span>استعمل الإعدادات الجاهزة أو حرّك أدوات التحكم.</span></div></li><li><b>٣</b><div><strong>نزّل النتيجة</strong><span>احفظ نسخة JPG جاهزة للمشاركة.</span></div></li></ol></section>

      <footer><a className="logo" href="#top"><span className="logo-mark">b</span><span>bot<span>.</span></span></a><p>تحسين صور واضح، سريع، وبدون ذكاء اصطناعي.</p><a href="#top">أعلى الصفحة ↑</a></footer>
    </main>
  );
}
