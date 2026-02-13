'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton, useUser } from '@clerk/nextjs'
import { cn } from '@0ne/ui'
import {
  Home,
  Settings,
  BarChart3,
  Users,
  Link2,
  ChevronDown,
  FolderOpen,
  RefreshCw,
  type LucideIcon
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { useSidebar } from './SidebarContext'
import { ThemeToggle } from './ThemeToggle'
import { SyncStatusIndicator } from './SyncStatusIndicator'
import type { AppId, UserPermissions } from '@0ne/auth/permissions'
import { getAppNavigation } from '@/lib/apps'

export interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  appId?: AppId // Link nav items to app permissions
  children?: { name: string; href: string }[]
}

interface SidebarProps {
  navigation?: NavItem[]
}

// Default navigation structure like Relay
const defaultNavigation: NavItem[] = [
  { name: 'Home', href: '/', icon: Home },
]

// All available apps - filtered based on user permissions
// Children are loaded dynamically from getAppNavigation()
const allAppsNavigation: NavItem[] = [
  {
    name: 'KPI Dashboard',
    href: '/kpi',
    icon: BarChart3,
    appId: 'kpi',
    children: getAppNavigation('kpi').map(item => ({ name: item.name, href: item.href }))
  },
  { name: 'Prospector', href: '/prospector', icon: Users, appId: 'prospector' },
  { name: 'Skool Sync', href: '/skool-sync', icon: Link2, appId: 'skoolSync' },
  {
    name: 'Skool Scheduler',
    href: '/skool',
    icon: RefreshCw,
    appId: 'skoolScheduler',
    children: getAppNavigation('skoolScheduler').map(item => ({ name: item.name, href: item.href }))
  },
  {
    name: 'GHL Media',
    href: '/media',
    icon: FolderOpen,
    appId: 'ghlMedia',
    children: getAppNavigation('ghlMedia').map(item => ({ name: item.name, href: item.href }))
  },
]

const accountNavigation: NavItem[] = [
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
    children: [
      { name: 'Sync', href: '/settings/sync' },
    ],
  },
]

export function Sidebar({ navigation }: SidebarProps) {
  const pathname = usePathname()
  const { isOpen, toggle } = useSidebar()
  const { user } = useUser()
  const [expandedItems, setExpandedItems] = useState<string[]>(['/kpi'])

  // Get enabled apps from user permissions
  const appsNavigation = useMemo(() => {
    const permissions = user?.publicMetadata?.permissions as UserPermissions | undefined
    if (!permissions) return [] // No permissions loaded yet, show nothing

    return allAppsNavigation.filter(app => {
      if (!app.appId) return true // Items without appId always show
      return permissions.apps[app.appId] === true
    })
  }, [user?.publicMetadata?.permissions])

  const toggleExpanded = (href: string) => {
    setExpandedItems(prev =>
      prev.includes(href)
        ? prev.filter(h => h !== href)
        : [...prev, href]
    )
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const renderNavItem = (item: NavItem, showChildren = true) => {
    const active = isActive(item.href)
    const hasChildren = item.children && item.children.length > 0
    const isExpanded = expandedItems.includes(item.href)
    // Only show as expandable if it has children AND we want to show them
    const isExpandable = hasChildren && showChildren

    return (
      <div key={item.name}>
        <div className="flex items-center">
          {isExpandable ? (
            <button
              onClick={() => toggleExpanded(item.href)}
              className={cn(
                'flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              )}
            >
              <item.icon className={cn(
                'h-5 w-5',
                active ? 'text-sidebar-primary' : 'text-sidebar-primary/70'
              )} />
              <span className="flex-1 text-left">{item.name}</span>
              <ChevronDown className={cn(
                'h-4 w-4 transition-transform',
                isExpanded && 'rotate-180'
              )} />
            </button>
          ) : (
            <Link
              href={item.href}
              className={cn(
                'flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              )}
            >
              <item.icon className={cn(
                'h-5 w-5',
                active ? 'text-sidebar-primary' : 'text-sidebar-primary/70'
              )} />
              {item.name}
            </Link>
          )}
        </div>

        {/* Submenu */}
        {isExpandable && isExpanded && (
          <div className="ml-4 mt-1 space-y-1 border-l border-sidebar-border pl-4">
            {item.children!.map((child) => {
              const childActive = pathname === child.href
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  className={cn(
                    'block rounded-md px-3 py-1.5 text-sm transition-colors',
                    childActive
                      ? 'text-sidebar-primary font-medium'
                      : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'
                  )}
                >
                  {child.name}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Toggle Button - Shows "O" when closed (in main area), hidden when open (logo in sidebar is clickable) */}
      {!isOpen && (
        <button
          onClick={toggle}
          className="fixed top-4 left-4 z-50 flex items-center justify-center text-primary hover:opacity-80"
          aria-label="Open navigation"
        >
          <span className="font-heading text-2xl font-bold italic">O</span>
        </button>
      )}

      {/* Backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm lg:hidden"
          onClick={toggle}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-sidebar transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo header - entire area clickable to collapse */}
        <button
          onClick={toggle}
          className="flex h-16 w-full items-center justify-between px-6 hover:bg-sidebar-accent/50 transition-colors"
          aria-label="Close navigation"
        >
          <span className="font-heading text-2xl font-bold italic text-sidebar-primary">
            One
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-sidebar-foreground/70"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* User Info (like Relay's account switcher) */}
        <div className="border-b border-sidebar-border px-4 pb-4">
          <div className="flex items-center gap-3">
            <UserButton
              afterSignOutUrl="/sign-in"
              appearance={{
                elements: {
                  avatarBox: 'h-10 w-10',
                },
              }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                Jimmy Fuentes
              </p>
              <p className="text-xs text-sidebar-foreground/60 truncate">
                Fruitful Funding
              </p>
            </div>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {/* Home */}
          <div className="space-y-1">
            {defaultNavigation.map(item => renderNavItem(item))}
          </div>

          {/* APPS Section */}
          <div className="mt-6">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              Apps
            </p>
            <div className="space-y-1">
              {appsNavigation.map(item => renderNavItem(item))}
            </div>
          </div>
        </nav>

        {/* Bottom Section */}
        <div className="border-t border-sidebar-border p-3">
          {/* ACCOUNT Section */}
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Account
          </p>
          <div className="space-y-1">
            {accountNavigation.map(item => renderNavItem(item, false))}
          </div>

          {/* Sync Status Indicator */}
          <div className="mt-2">
            <SyncStatusIndicator />
          </div>

          {/* Theme Toggle */}
          <div className="mt-3 flex items-center justify-between px-3">
            <span className="text-xs text-sidebar-foreground/60">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  )
}
