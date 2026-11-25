import './globals.css';

export const metadata = {
  title: 'Fiber Pay-to-Unlock',
  description: 'Sell encrypted digital products and get paid over Nervos CKB Fiber.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
