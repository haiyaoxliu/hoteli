import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { countReviewForUser } from "@/lib/review";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

async function reviewCount(): Promise<number> {
  try {
    const user = await getCurrentUser();
    return countReviewForUser(user.id);
  } catch {
    return 0;
  }
}

export const metadata: Metadata = {
  title: "Hoteli",
  description: "Your hotel history, tracked.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Hoteli" },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="px-3 py-2 text-sm text-muted hover:text-foreground transition-colors"
    >
      {label}
    </Link>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const reviews = await reviewCount();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
          <nav className="mx-auto flex max-w-3xl items-center gap-1 px-4 py-3">
            <Link href="/" className="mr-auto flex items-center gap-2 font-semibold">
              <span className="text-xl">🏨</span> Hoteli
            </Link>
            <NavLink href="/" label="Stays" />
            <NavLink href="/map" label="Map" />
            <NavLink href="/stats" label="Stats" />
            <Link
              href="/review"
              className="relative px-3 py-2 text-sm text-muted hover:text-foreground transition-colors"
            >
              Review
              {reviews > 0 && (
                <span className="absolute -right-1 -top-0.5 rounded-full bg-accent-warm px-1.5 text-xs font-semibold text-black">
                  {reviews}
                </span>
              )}
            </Link>
            <NavLink href="/settings" label="Settings" />
            <Link
              href="/stays/new"
              className="ml-1 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              + Add
            </Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
