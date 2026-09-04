'use client';

import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';

type Stage = 'idle' | 'preparing' | 'processing' | 'done';
type Shot = { url: string; width: number; height: number };
type Service = {
  ready: boolean;
  configured: boolean;
  storage: boolean;
  remaining: number;
  limit: number;
  maxOutputEdge: number;
  /** Contract with the backend (docs/REVIEW.md round 7). Absent until it lands. */
  signedIn?: boolean;
  name?: string;
};

const FALLBACK_EDGE = 2048;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

/**
 * Downscaling before upload is not an optimisation — providers bill on output
 * megapixels, and a modern phone photo sent at full size costs roughly fifteen
 * times a capped one (docs/DISCUSSION.md §3).
 */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  // createImageBitmap decodes off the main thread where it exists, which keeps
  // a 12MP phone photo from freezing the page. Not every browser has it for
  // every format, so the element path stays as a fallback.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through: some browsers reject formats here that <img> still decodes.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('decode'));
      element.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

/**
 * Downscaling before upload is not an optimisation — providers bill on output
 * megapixels, and a modern phone photo sent at full size costs roughly fifteen
 * times a capped one (docs/DISCUSSION.md §3).
 *
 * Re-encoding to JPEG here also means the server only ever receives JPEG,
 * whatever the visitor picked. That is what makes accepting HEIC safe: iPhones
 * shoot HEIC by default, and rejecting it at the picker turned away a large
 * share of the audience for no reason.
 */
async function prepare(file: File, maxEdge: number): Promise<{ blob: Blob; width: number; height: number }> {
  const decoded = await decode(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('encode');
    return { blob, width, height };
  } finally {
    decoded.close();
  }
}

function baseName(name: string): string {
  return name.replace(/\.[^/.]+$/, '') || 'photo';
}

/**
 * The referral tag the bot attaches to its link, remembered for the visit so a
 * conversion is still attributed after a reload — otherwise everything past
 * the first page view counts as coming from nowhere.
 *
 * Read at request time rather than held in state: it never changes during a
 * visit, and nothing renders from it.
 */
function readReferral(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = new URLSearchParams(window.location.search).get('ref');
  try {
    if (fromUrl) window.sessionStorage.setItem('ref', fromUrl);
    return fromUrl || window.sessionStorage.getItem('ref');
  } catch {
    // Private mode or blocked storage: the URL alone still works.
    return fromUrl;
  }
}

/**
 * Telegram's widget injects its own iframe from a script tag, so it is mounted
 * imperatively. The domain must be linked to the bot with BotFather /setdomain
 * or Telegram refuses to render it — hence the fallback copy.
 */
function TelegramSignIn({ botUsername }: { botUsername: string }) {
  const slot = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = slot.current;
    if (!host) return;
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'small');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-auth-url', '/api/auth/telegram');
    script.setAttribute('data-request-access', 'write');
    script.onerror = () => setFailed(true);
    host.appendChild(script);
    return () => {
      host.replaceChildren();
    };
  }, [botUsername]);

  if (failed) return null;
  return <div className="signin" ref={slot} aria-label="تسجيل الدخول بتلگرام" />;
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const job = useRef(0);

  const [service, setService] = useState<Service | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [before, setBefore] = useState<Shot | null>(null);
  const [after, setAfter] = useState<Shot | null>(null);
  const [split, setSplit] = useState(50);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hovering, setHovering] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/enhance')
      .then((response) => response.json())
      .then(setService)
      .catch(() => setService(null));
    fetch('/api/telegram')
      .then((response) => response.json())
      .then((info: { botUsername: string | null }) => setBotUsername(info.botUsername))
      .catch(() => setBotUsername(null));
  }, []);

  // Object URLs are revoked on replacement and on unmount to avoid leaking blobs.
  useEffect(
    () => () => {
      if (before) URL.revokeObjectURL(before.url);
      if (after) URL.revokeObjectURL(after.url);
    },
    [before, after],
  );

  const run = useCallback(
    async (file: File) => {
      const current = ++job.current;
      const maxEdge = service?.maxOutputEdge ?? FALLBACK_EDGE;

      setError(null);
      setElapsed(null);
      setFileName(file.name);
      setAfter((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return null;
      });
      setStage('preparing');

      let prepared: { blob: Blob; width: number; height: number };
      try {
        prepared = await prepare(file, maxEdge);
      } catch {
        if (current === job.current) {
          setStage('idle');
          setError('ما گدرنا نقرأ هذي الصورة. جرّب صورة ثانية.');
        }
        return;
      }
      if (current !== job.current) return;

      setBefore((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { url: URL.createObjectURL(prepared.blob), width: prepared.width, height: prepared.height };
      });
      setSplit(50);
      setStage('processing');

      const body = new FormData();
      body.append('image', new File([prepared.blob], 'upload.jpg', { type: 'image/jpeg' }));

      try {
        const referral = readReferral();
        const response = await fetch('/api/enhance', {
          method: 'POST',
          body,
          headers: referral ? { 'x-ref': referral } : undefined,
        });
        if (current !== job.current) return;

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          setStage('idle');
          setError(payload?.error ?? 'صار خلل أثناء المعالجة. جرّب مرة ثانية.');
          setService((previous) => (previous ? { ...previous, remaining: 0 } : previous));
          return;
        }

        const blob = await response.blob();
        if (current !== job.current) return;

        setAfter({
          url: URL.createObjectURL(blob),
          width: Number(response.headers.get('x-output-width')) || prepared.width,
          height: Number(response.headers.get('x-output-height')) || prepared.height,
        });
        setElapsed(Number(response.headers.get('x-duration-ms')) || null);
        setService((previous) =>
          previous ? { ...previous, remaining: Number(response.headers.get('x-remaining') ?? previous.remaining) } : previous,
        );
        setStage('done');
      } catch {
        if (current !== job.current) return;
        setStage('idle');
        setError('انقطع الاتصال. تأكد من الإنترنت وجرّب مرة ثانية.');
      }
    },
    [service],
  );

  const accept = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setError('اختر ملف صورة.');
        return;
      }
      if (file.size > MAX_INPUT_BYTES) {
        setError('حجم الصورة كبير. المسموح حتى 15 ميغابايت.');
        return;
      }
      void run(file);
    },
    [run],
  );

  // Paste from clipboard — the fastest path for a screenshot or a copied photo.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'));
      if (item) accept(item.getAsFile());
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [accept]);

  // One pointer handler covers mouse, pen and touch for the comparison handle.
  const moveSplit = useCallback((clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    setSplit(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100)));
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      event.preventDefault();
      moveSplit(event.clientX);
    };
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [moveSplit]);

  const onKeySplit = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === 'ArrowLeft') setSplit((value) => Math.max(0, value - step));
    else if (event.key === 'ArrowRight') setSplit((value) => Math.min(100, value + step));
    else if (event.key === 'Home') setSplit(0);
    else if (event.key === 'End') setSplit(100);
    else return;
    event.preventDefault();
  };

  const download = () => {
    if (!after) return;
    const link = document.createElement('a');
    link.href = after.url;
    link.download = `${baseName(fileName)}-محسّنة.png`;
    link.click();
  };

  const reset = () => {
    job.current += 1;
    setBefore((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
    setAfter((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
    setStage('idle');
    setElapsed(null);
    setError(null);
    setFileName('');
  };

  const busy = stage === 'preparing' || stage === 'processing';
  const offline = service !== null && !service.ready;

  return (
    <main className="site-shell">
      <header className="bar">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 17.5 9 11l3.5 4L16 10.5 20 16" />
              <circle cx="15.5" cy="7" r="1.8" />
              <rect x="2.6" y="3.6" width="18.8" height="16.8" rx="3.4" strokeWidth="1.5" />
            </svg>
          </span>
          <span className="brand-lockup">
            <span className="brand-name">صفّي</span>
            <span className="brand-sub">مختبر ترميم الصور</span>
          </span>
        </a>
        <div className="bar-side">
          <a className="bar-link" href="#how">كيف يشتغل</a>
          {service?.storage && (
            <span className={service.signedIn ? 'quota is-user' : 'quota'} title="رصيدك اليوم">
              <b>{service.remaining}</b>
              <span>/{service.limit} اليوم</span>
            </span>
          )}
          {service?.signedIn && service.name ? (
            <span className="who" title="مسجّل بحساب تلگرام">
              {service.name}
            </span>
          ) : (
            botUsername && <TelegramSignIn botUsername={botUsername} />
          )}
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span aria-hidden="true" /> ترميم وتحسين تلقائي بالذكاء الاصطناعي</p>
          <h1>
            لا تخلي الذكرى
            <em>تضيع بالتشويش.</em>
          </h1>
          <p className="lede">
            ارفع الصورة، وصفّي يتكفّل بالباقي: تفاصيل أوضح، ألوان أهدأ، ونتيجة جاهزة للحفظ — بلا إعدادات ولا تعب.
          </p>
          <a className="hero-cta" href="#studio">ابدأ بالصورة <span aria-hidden="true">↙</span></a>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <span className="orbital orbital-one">وضوح</span>
          <span className="orbital orbital-two">تفاصيل</span>
          <div className="scan-card">
            <div className="scan-line" />
            <span>AI</span>
            <small>RESTORE</small>
          </div>
        </div>
      </section>

      <section className="studio" id="studio">
        {offline && (
          <div className="notice" role="status">
            <b>الخدمة تحت التجهيز</b>
            <span>
              {!service?.configured
                ? 'النموذج لم يُربط بعد. الموقع جاهز، وينتظر تفعيل المفتاح.'
                : 'قاعدة العدّاد غير مهيّأة. المعالجة موقوفة حتى تُضبط، حمايةً للتكلفة.'}
            </span>
          </div>
        )}

        {!before ? (
          <div
            className={hovering ? 'drop is-over' : 'drop'}
            onDragOver={(event) => {
              event.preventDefault();
              setHovering(true);
            }}
            onDragLeave={() => setHovering(false)}
            onDrop={(event) => {
              event.preventDefault();
              setHovering(false);
              accept(event.dataTransfer.files?.[0]);
            }}
          >
            <div className="drop-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
                <path d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15" />
              </svg>
            </div>
            <h2>اسحب صورتك هنا</h2>
            <p>أو الصقها بـ Ctrl+V، أو اختَرها من جهازك</p>
            <button type="button" className="cta" onClick={() => fileInput.current?.click()} disabled={offline}>
              اختيار صورة
            </button>
            <small className="drop-meta">JPG · PNG · WebP · HEIC — حتى 15 ميغابايت</small>
          </div>
        ) : (
          <div className="work">
            <div className="work-head">
              <div className="work-file">
                <strong title={fileName}>{fileName}</strong>
                {before && after && (
                  <span className="dims" dir="ltr">
                    {before.width}×{before.height} <i aria-hidden="true">→</i> {after.width}×{after.height}
                  </span>
                )}
                {before && !after && (
                  <span className="dims" dir="ltr">
                    {before.width}×{before.height}
                  </span>
                )}
              </div>
              {elapsed !== null && (
                <span className="chip">
                  {elapsed < 950 ? `تمّت خلال أقل من ثانية` : `تمّت خلال ${(elapsed / 1000).toFixed(1)} ثانية`}
                </span>
              )}
            </div>

            <div className="frame" ref={frame}>
              <img className="layer" src={before.url} alt="الصورة قبل المعالجة" draggable={false} />
              {after && (
                <>
                  <div className="layer clipped" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
                    <img src={after.url} alt="الصورة بعد المعالجة" draggable={false} />
                  </div>
                  <span className="tag tag-before">قبل</span>
                  <span className="tag tag-after">بعد</span>
                  <div
                    className="handle"
                    style={{ left: `${split}%` }}
                    role="slider"
                    tabIndex={0}
                    aria-label="قارن قبل وبعد"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(split)}
                    onPointerDown={(event) => {
                      dragging.current = true;
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                      moveSplit(event.clientX);
                    }}
                    onKeyDown={onKeySplit}
                  >
                    <span className="grip" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 7.5 19 12l-4.5 4.5M9.5 7.5 5 12l4.5 4.5" />
                      </svg>
                    </span>
                  </div>
                </>
              )}

              {busy && (
                <div className="veil">
                  <span className="pulse" aria-hidden="true" />
                  <b>{stage === 'preparing' ? 'نجهّز الصورة…' : 'نرمّم الصورة…'}</b>
                  <small>{stage === 'preparing' ? 'نضبط المقاس قبل الإرسال' : 'تأخذ عادةً بين 5 و20 ثانية'}</small>
                </div>
              )}
            </div>

            <div className="work-actions">
              <button type="button" className="ghost" onClick={reset} disabled={busy}>
                صورة ثانية
              </button>
              <button type="button" className="cta" onClick={download} disabled={!after || busy}>
                نزّل النتيجة
              </button>
            </div>

            {after && <p className="hint">اسحب المقبض، أو استعمل أسهم لوحة المفاتيح، حتى تشوف الفرق</p>}
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <p className="sr-only" role="status" aria-live="polite">
          {stage === 'preparing'
            ? 'نجهّز الصورة'
            : stage === 'processing'
              ? 'نرمّم الصورة، انتظر من فضلك'
              : stage === 'done'
                ? 'النتيجة جاهزة. استعمل أسهم لوحة المفاتيح على مقبض المقارنة لتشوف الفرق.'
                : ''}
        </p>

        <input
          ref={fileInput}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          type="file"
          accept="image/*"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            accept(event.target.files?.[0]);
            event.target.value = '';
          }}
        />

        {/* F3 — the output carries an invisible SynthID marker. Saying so is
            cheaper than being found out. */}
        <p className="expectation">
          <span aria-hidden="true">ⓘ</span>
          <span>
            صفّي يرمّم ويحسّن الموجود في الصورة — يشدّ الملامح ويرجّع التفاصيل والألوان.
            ما يخترع أشياء ناقصة، ويحافظ على ملامح الشخص مثل ما هي.
            <br />
            النتيجة تحمل علامة <b>SynthID</b> غير مرئية تدلّ على أنها عولجت بالذكاء الاصطناعي.
          </span>
        </p>
      </section>

      <section className="how" id="how">
        <h2>ثلاث خطوات</h2>
        <ol>
          <li>
            <b>١</b>
            <div>
              <strong>ارفع الصورة</strong>
              <span>اسحبها، أو الصقها، أو اختَرها من جهازك.</span>
            </div>
          </li>
          <li>
            <b>٢</b>
            <div>
              <strong>يشتغل عليها تلقائياً</strong>
              <span>بلا أدوات ولا ضبط — الذكاء الاصطناعي يتكفّل.</span>
            </div>
          </li>
          <li>
            <b>٣</b>
            <div>
              <strong>قارن ونزّل</strong>
              <span>اسحب المقبض تشوف الفرق، وبعدها احفظها.</span>
            </div>
          </li>
        </ol>
      </section>

      <footer>
        <span className="brand-name">صفّي</span>
        <p>ترميم وتحسين الصور بالذكاء الاصطناعي</p>
      </footer>
    </main>
  );
}
