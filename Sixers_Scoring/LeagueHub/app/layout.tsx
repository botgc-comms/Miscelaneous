import type { Metadata } from 'next';
import './globals.css';
import './parent.css';
import './responsive.css';
import './fixture-preparation.css';
import './roster-layout.css';
import './admin-assistant.css';
import './season-setup.css';
import './support.css';
export const metadata: Metadata = {
  title: 'GolfSixes League | Your season, together',
  description: 'Junior leagues, clubs, teams, fixtures and shared scorecards.',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
