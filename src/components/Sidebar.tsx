"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGet } from "./api";
import { Icon } from "./icons";

type BadgeKind = "inbox" | "tasks";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  badge?: BadgeKind;
};

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Prospección",
    items: [
      { href: "/finder", label: "AI Finder", icon: "target" },
      { href: "/leads", label: "Leads", icon: "users" },
      { href: "/lists", label: "Listas", icon: "list" },
      { href: "/companies", label: "Empresas", icon: "building" },
    ],
  },
  {
    title: "Outreach",
    items: [
      { href: "/campaigns", label: "Campañas", icon: "send" },
      { href: "/tasks", label: "Tareas", icon: "check", badge: "tasks" },
      { href: "/inbox", label: "Inbox", icon: "mail", badge: "inbox" },
    ],
  },
  {
    title: "Configuración",
    items: [
      { href: "/playbook", label: "Playbook", icon: "book" },
      { href: "/analytics", label: "Analytics", icon: "chart" },
      { href: "/settings", label: "Ajustes", icon: "gear" },
    ],
  },
];

type Counts = { inbox: number; tasks: number };

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarContent({
  collapsed,
  counts,
  onNavigate,
}: {
  collapsed: boolean;
  counts: Counts;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div
        className={`flex items-center gap-2.5 border-b border-slate-800 px-4 py-4 ${
          collapsed ? "justify-center px-2" : ""
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-white">
          <Icon name="sparkles" className="h-4 w-4" />
        </span>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Prospector</p>
            <p className="truncate text-[11px] text-slate-400">Prospección y outreach</p>
          </div>
        ) : null}
      </div>

      <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-5">
            {!collapsed ? (
              <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                {section.title}
              </p>
            ) : (
              <div className="mx-2 mb-2 border-t border-slate-800" />
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                const badgeValue = item.badge ? counts[item.badge] : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      className={`group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        collapsed ? "justify-center" : ""
                      } ${
                        active
                          ? "bg-indigo-500/15 font-medium text-white"
                          : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
                      }`}
                    >
                      <Icon
                        name={item.icon}
                        className={`h-4 w-4 shrink-0 ${active ? "text-indigo-300" : ""}`}
                      />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      {!collapsed && badgeValue > 0 ? (
                        <span className="ml-auto rounded-full bg-indigo-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                          {badgeValue}
                        </span>
                      ) : null}
                      {collapsed && badgeValue > 0 ? (
                        <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-indigo-400" />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {!collapsed ? (
        <div className="border-t border-slate-800 px-4 py-3">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Datos locales en SQLite. La prospección usa la búsqueda web, el BORME y
            las webs públicas de cada negocio.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [counts, setCounts] = useState<Counts>({ inbox: 0, tasks: 0 });

  const loadCounts = useCallback(async () => {
    try {
      const [inbox, tasks] = await Promise.all([
        apiGet<{ unreadCount: number }>("/api/inbox"),
        apiGet<{ tasks: unknown[] }>("/api/tasks?status=open"),
      ]);
      setCounts({ inbox: inbox.unreadCount ?? 0, tasks: tasks.tasks?.length ?? 0 });
    } catch {
      // Los badges son informativos: si fallan, la navegación sigue funcionando.
    }
  }, []);

  useEffect(() => {
    void loadCounts();
    const timer = setInterval(() => void loadCounts(), 30000);
    return () => clearInterval(timer);
  }, [loadCounts]);

  useEffect(() => {
    setMobileOpen(false);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("prospector:sidebar-collapsed");
      if (stored === "1") setCollapsed(true);
    } catch {
      // localStorage puede estar bloqueado: se mantiene el estado por defecto.
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem("prospector:sidebar-collapsed", next ? "1" : "0");
      } catch {
        // Sin persistencia, el estado solo vive en esta sesión.
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700"
          >
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500 text-white">
              <Icon name="sparkles" className="h-3.5 w-3.5" />
            </span>
            Prospector
          </span>
        </div>
        <Link
          href="/finder"
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
        >
          Buscar
        </Link>
      </header>

      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden shrink-0 transition-[width] duration-200 lg:flex ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        <SidebarContent collapsed={collapsed} counts={counts} />
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          title={collapsed ? "Expandir menú" : "Contraer menú"}
          className="absolute top-4 -right-3 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-slate-900"
        >
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} className="h-3.5 w-3.5" />
        </button>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-64 shadow-xl">
            <SidebarContent
              collapsed={false}
              counts={counts}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <main className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-16" : "lg:pl-64"}`}>
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
