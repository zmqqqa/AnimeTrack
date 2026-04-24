"use client";

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { navigationItems, config, type NavigationSection } from '@/lib/config';

interface SidebarLayoutProps {
  children: React.ReactNode;
}

type SessionUser = {
  role?: string;
};

export default function SidebarLayout({ children }: SidebarLayoutProps) {
  const { data: session, status } = useSession();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const showLocalSetup = process.env.NODE_ENV !== 'production';
  const isAuthPage = pathname === '/login' || pathname === '/register';

  const isAuthenticated = status === 'authenticated';
  const isAdmin = (session?.user as SessionUser | undefined)?.role === 'admin';
  const userName = typeof session?.user?.name === 'string' ? session.user.name : '管理员';

  const groupedMenuItems = (['主馆区', '分析馆', '管理区'] as NavigationSection[])
    .map((section) => ({
      section,
      items: navigationItems.filter((item) => item.section === section && (!item.adminOnly || isAdmin)),
    }))
    .filter((group) => group.items.length > 0);

  const animeSubsectionHrefs = navigationItems
    .map((item) => item.href)
    .filter((href) => href.startsWith('/anime/') && href !== '/anime');

  const doesPathMatchItem = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/anime') {
      const isKnownSubsection = animeSubsectionHrefs.some((subsectionHref) => (
        pathname === subsectionHref || pathname.startsWith(`${subsectionHref}/`)
      ));

      return pathname === '/anime' || (pathname.startsWith('/anime/') && !isKnownSubsection);
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const activeHref = groupedMenuItems
    .flatMap((group) => group.items)
    .map((item) => item.href)
    .filter((href) => doesPathMatchItem(href))
    .sort((left, right) => right.length - left.length)[0] ?? null;

  const isItemActive = (href: string) => href === activeHref;

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setIsMobileMenuOpen(false);

    try {
      const response = await signOut({
        redirect: false,
        callbackUrl: '/login',
      });

      const targetUrl = response?.url || '/login';
      router.replace(targetUrl);
      router.refresh();
      window.location.assign(targetUrl);
    } catch {
      setIsSigningOut(false);
    }
  };

  if (isAuthPage) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-transparent relative">
      {/* 手机端头部 */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-zinc-950/85 backdrop-blur-xl border-b border-white/5 z-30 flex items-center justify-between px-4">
        <div>
          <p className="text-[10px] text-emerald-300/70">番剧记录</p>
          <h1 className="text-lg font-display tracking-tight text-zinc-100">{config.appName}</h1>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="surface-pill p-2 hover:bg-white/5 rounded-xl transition-all duration-200"
          aria-label="菜单"
        >
          <svg className="w-6 h-6 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
          </svg>
        </button>
      </div>

      {/* 手机端遮罩 */}
      {isMobileMenuOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* 侧边栏 */}
      <aside 
        className={`
          ${collapsed ? 'lg:w-24' : 'lg:w-80'} 
          fixed lg:relative inset-y-0 left-0 z-50 transform 
          ${isMobileMenuOpen ? 'translate-x-0 w-80 max-w-[85vw]' : '-translate-x-full w-80 max-w-[85vw] lg:translate-x-0'}
          bg-zinc-950/92 lg:bg-zinc-950/58 backdrop-blur-2xl border-r border-white/5 
          transition-all duration-300 flex flex-col
        `}
      >
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(86,211,156,0.12),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(93,214,242,0.1),transparent_28%)]" />

        {/* Logo (仅桌面端显示) */}
        <div className="hidden lg:block p-4 border-b border-border/50 relative z-10">
          <div className={`glass-panel-strong surface-highlight rounded-[28px] transition-all duration-300 ${collapsed ? 'px-3 py-4' : 'px-5 py-5'}`}>
            <div className="flex items-start justify-between gap-3">
              {!collapsed && (
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] text-emerald-200/80">
                    番剧追踪
                  </div>
                  <div>
                    <h1 className="text-xl font-display tracking-tight text-zinc-100">{config.appName}</h1>
                  </div>
                </div>
              )}
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="surface-pill p-2 hover:bg-white/5 rounded-xl transition-all duration-200 hover:text-primary"
                aria-label={collapsed ? '展开' : '收起'}
              >
                <svg 
                  className="w-5 h-5" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d={collapsed ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} 
                  />
                </svg>
              </button>
            </div>
            {!collapsed && (
              <div className="mt-3">
                <span className="surface-pill rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-zinc-400">
                  {isAdmin ? '管理员模式' : isAuthenticated ? '已登录' : '公开浏览'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 导航 */}
        <nav className="flex-1 py-5 mt-16 lg:mt-0 relative z-10 overflow-y-auto">
          {groupedMenuItems.map((group) => (
            <div key={group.section} className="space-y-2 pb-3">
              {!collapsed && (
                <div className="px-4 pb-2 text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                  {group.section}
                </div>
              )}
              {group.items.map((item) => {
                const isActive = isItemActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`
                      relative flex items-center gap-3 px-4 py-3.5 mx-3 rounded-2xl
                      transition-all duration-300 group overflow-hidden border
                      ${isActive
                        ? 'bg-emerald-400/10 text-zinc-50 border-emerald-400/20 shadow-[0_18px_40px_rgba(16,185,129,0.12)]'
                        : 'text-zinc-400 border-transparent hover:bg-white/[0.04] hover:text-zinc-200 hover:border-white/5 hover:translate-x-1'
                      }
                    `}
                    title={collapsed ? item.label : item.description}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-10 bg-emerald-300 rounded-r-full shadow-[0_0_14px_rgba(86,211,156,0.6)]" />
                    )}
                    {isActive && <div className="absolute inset-0 bg-gradient-to-r from-emerald-400/10 via-white/[0.02] to-transparent opacity-80" />}

                    <div className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-2xl border text-sm font-semibold ${isActive ? 'border-emerald-300/25 bg-emerald-300/12 text-emerald-100' : 'surface-pill text-zinc-400 group-hover:text-zinc-200'}`}>
                      {item.label.charAt(0)}
                    </div>

                    {!collapsed && (
                      <div className="relative z-10 min-w-0 flex-1">
                        <div className={`text-sm tracking-wide ${isActive ? 'font-semibold text-zinc-50' : 'font-medium'}`}>
                          {item.label}
                        </div>
                        <div className={`text-[11px] mt-0.5 truncate ${isActive ? 'text-zinc-300/80' : 'text-zinc-500 group-hover:text-zinc-400'}`}>
                          {item.description}
                        </div>
                      </div>
                    )}

                    {!collapsed && (
                      <span className={`relative z-10 text-xs transition-all ${isActive ? 'text-emerald-200/70' : 'text-zinc-600 group-hover:text-emerald-200/60'}`}>
                        ↗
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* 底部信息 */}
        {(showLocalSetup || isAuthenticated) && (
          <div className="p-4 border-t border-border/50 bg-black/10 relative z-10">
            <div className={`glass-panel rounded-[24px] border-white/5 ${collapsed ? 'px-2 py-3' : 'px-4 py-4'}`}>
              {!collapsed ? (
                <div className="flex flex-col gap-3">
                  {showLocalSetup && (
                    <Link
                      href="/setup"
                      className="text-xs flex items-center justify-between gap-2 rounded-2xl border border-emerald-400/18 bg-emerald-400/10 px-3 py-2.5 text-emerald-100 hover:text-emerald-50 hover:border-emerald-300/30 hover:bg-emerald-400/14 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                        </svg>
                        本地初始化 /setup
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.28em]">Open</span>
                    </Link>
                  )}
                  {isAuthenticated && (
                    <>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Curator</p>
                        <p className="mt-1 text-sm text-zinc-200">{userName}</p>
                      </div>
                      <button 
                        onClick={handleSignOut}
                        disabled={isSigningOut}
                        className="surface-pill text-xs flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 text-zinc-300 hover:text-red-300 hover:border-red-400/20 hover:bg-red-400/5 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          {isSigningOut ? '正在退出...' : '退出登录'}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.28em]">Leave</span>
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  {showLocalSetup && (
                    <Link
                      href="/setup"
                      className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-400/18 bg-emerald-400/10 text-emerald-100 hover:text-emerald-50 hover:border-emerald-300/30 hover:bg-emerald-400/14 transition-colors"
                      aria-label="本地初始化"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                      </svg>
                    </Link>
                  )}
                  {isAuthenticated && (
                    <button 
                      onClick={handleSignOut}
                      disabled={isSigningOut}
                      className="surface-pill mx-auto flex h-10 w-10 items-center justify-center rounded-2xl text-zinc-300 hover:text-red-300 hover:border-red-400/20 hover:bg-red-400/5 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label="退出登录"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto relative z-10 scroll-smooth bg-[linear-gradient(180deg,rgba(255,255,255,0.01),transparent_18%,rgba(255,255,255,0.015))] backdrop-blur-[1px] pt-16 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
