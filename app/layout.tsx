import type { Metadata, Viewport } from 'next';
import './globals.css';

const title = 'صفّي — ترميم وتحسين الصور بالذكاء الاصطناعي';
const description =
  'ارفع صورتك القديمة أو المشوّشة ويرمّمها الذكاء الاصطناعي تلقائياً: ملامح أوضح، تفاصيل أدق، وألوان مصحّحة.';

export const metadata: Metadata = {
  title,
  description,
  icons: { icon: '/favicon.svg' },
  openGraph: { title, description, images: [{ url: '/og.png', width: 1200, height: 630, alt: title }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
};

export const viewport: Viewport = {
  themeColor: '#0a0b0d',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
