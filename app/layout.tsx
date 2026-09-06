import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegisterServiceWorker } from './register-sw';

const title = 'صفّي — ترميم وتحسين الصور بالذكاء الاصطناعي';
const description =
  'ارفع صورتك القديمة أو المشوّشة ويرمّمها الذكاء الاصطناعي تلقائياً: ملامح أوضح، تفاصيل أدق، وألوان مصحّحة.';

export const metadata: Metadata = {
  title,
  description,
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
  // Lets iOS run it full-screen from the home screen, which is the closest
  // Safari gets to the installed app Android offers through the manifest.
  appleWebApp: { capable: true, title: 'صفّي', statusBarStyle: 'black-translucent' },
  openGraph: { title, description, images: [{ url: '/og.png', width: 1200, height: 630, alt: title }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
};

export const viewport: Viewport = {
  // Matches the manifest's background so the launch screen does not flash a
  // different colour before the interface paints.
  themeColor: '#040a14',
  colorScheme: 'dark',
  // The installed app runs edge to edge; without this the notch area is a bar.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
