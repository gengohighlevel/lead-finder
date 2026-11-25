import './globals.css';

export const metadata = { title: 'Lead Finder' };
export const viewport = { width: 'device-width', initialScale: 1 };

const BOOT = `(function(){try{var r=document.documentElement,s=localStorage,v=JSON.parse(s.getItem('lf-vars')||'{}');for(var k in v)r.style.setProperty(k,v[k]);if(s.getItem('lf-bg')==='custom'){var i=s.getItem('lf-bg-image');if(i)r.style.setProperty('--bg-image','url("'+i+'") center / cover no-repeat')}var a=JSON.parse(s.getItem('lf-attrs')||'{}');if(a.theme)r.dataset.theme=a.theme;if(a.frost)r.dataset.frost='on'}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies saved Settings before the first paint, so the page never flashes the default look. Mirrors appearanceStore.ts. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      {/* browser extensions (e.g. ColorZilla) add attributes to <body> before React loads; ignore only that mismatch */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
