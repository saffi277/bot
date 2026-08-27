import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'bot — تحسين الصور بدون ذكاء اصطناعي',
  description: 'نظّف صورك واضبط الإضاءة والألوان والوضوح مباشرة من المتصفح.',
  openGraph: {
    title: 'bot — خلّي صورتك أنظف',
    description: 'تحسين صور بدون ذكاء اصطناعي، مباشرة من المتصفح.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'bot — خلّي صورتك أنظف' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'bot — خلّي صورتك أنظف',
    description: 'تحسين صور بدون ذكاء اصطناعي، مباشرة من المتصفح.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
