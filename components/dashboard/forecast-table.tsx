"use client"

import { useState, useEffect, useMemo, useRef, Fragment } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Pencil, Check, X, Loader2, Calendar, CalendarDays, TrendingUp, TrendingDown, Filter, ArrowDownAZ, ListOrdered } from "lucide-react"
import {
  type ForecastResult,
  getShortMonthName,
  formatCurrency,
  isSubtotalDescription,
  isLeafDescription,
  normDesc,
  isRevenueLine,
  isExpenseLine,
  getOntarioWorkingDays
} from "@/lib/forecasting"
import { cn } from "@/lib/utils"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { createClient } from "@/lib/supabase/client"

const KPI_REVENUE = "TOTAL NET REVENUE"
const KPI_EXPENSE_LINES = new Set(["TOTAL EXPENSES", "TOTAL OVERHEAD ALLOCATIONS"])

// Items hidden from display (below External Profit)
export const HIDDEN_BELOW_EXTERNAL = new Set([
  "FOREIGN EXCHANGE GAIN/LOSS",
  "ROYALTY FEES",
  "INTEREST EXPENSE ORKIN",
  "CANADIAN TAXES",
  "NON-OP INT EXP/(REV)",
  "NET PROFIT",
])

// Statutory/fixed lines — non-editable (use budget figures)
const BUDGET_ONLY_DESCS = new Set([
  "SALES ALLOCATIONS", "QA ALLOCATIONS", "AR ALLOCATIONS",
  "DATA PROCESSING ALLOCATIONS", "ACCOUNTING ALLOCATIONS",
  "ADVERTISING & MKTG - ALLOCATION", "REGION SUPPORT SERVICES",
  "CANADA OVERHEAD ALLOCATIONS", "BMT ALLOCATIONS",
  "FLEET ALLOCATIONS", "CORPORATE ADMIN ALLOCATIONS",
  "HO ADMIN ALLOCATIONS", "HUMAN RESOURCES ALLOCATIONS",
  "INFORMATION TECH. ALLOCATIONS",
  "OVERHEAD ALLOCATION REVERSAL",
  "HOME OFFICE OVERHEAD",
  "ACQUISITION COST",
  "ULTIPRO COST",
])

// Computed subtotal lines — non-editable (sum of children)
const NON_EDITABLE_SUBTOTALS = new Set([
  "GROSS CONTRACT REVENUE",
])

// Template order matching production display order
export const TEMPLATE_ORDER = [
  "PEST CONTROL REVENUE",
  "COMMERCIAL REVENUE",
  "COMMERCIAL BED BUG REVENUE (recur)",
  "FLY CONTROL",
  "ORKIN/AIRE",
  "FEMININE HYGIENE",
  "DRAIN MAINTENANCE",
  "SOAK TANK",
  "SUBTOTAL MONTHLY",
  "RESIDENTIAL CONTRACT",
  "VALU PLUS COMM REVENUE",
  "SEASONAL REV  & OTHER",
  "SUBTOTAL/ALTERNATE/SEASONAL",
  "GROSS CONTRACT REVENUE",
  "ALLOWANCES",
  "PC COMM MGMT FAILURE",
  "RESIDENTIAL MGMT FAILURE",
  "YEAR IN ADVANCE",
  "PC SALES DISC",
  "TOTAL ALLOWANCES",
  "NET CONTRACT REVENUE",
  "MISCELLANEOUS REVENUE",
  "RESIDENTIAL BED BUG REVENUE",
  "COMMERCIAL BED BUG REVENUE",
  "RESIDENTIAL SPECIAL SERVICES",
  "COMMERCIAL SPECIAL SERVICES",
  "PRODUCT SALES",
  "FUMIGATION PC",
  "TOTAL MISC REVENUE",
  "TOTAL NET PC REVENUE",
  "TERMITE (TC) REVENUE",
  "TERMITE TREATING",
  "TC MGMT FAILURE",
  "PRETREAT",
  "INSPECTION FEES",
  "TOTAL NET TC REVENUE",
  "TOTAL NET REVENUE",
  "PAYROLL",
  "DIVISION MANAGER",
  "REGION MANAGER SALARY",
  "BRANCH MANAGER SALARY",
  "QUALITY ASSURANCE",
  "MANAGER TRAINEE",
  "SUBTOTALS MANAGERS",
  "MANAGERS INCENTIVES PAID",
  "MGR INCENTIVE ACCRUED",
  "SUBTOTAL MGR INCENTIVES",
  "OFFICE SALARIES",
  "VAC / HOLIDAY / SICK",
  "OFFICE SAL FLD OT",
  "TEMP OFFICE PERS",
  "SUBTOTAL OFFICE",
  "SUBTOTAL ADMIN PAYROLL",
  "SALESPERSON SALARIES",
  "ASM & NATIONAL SALES SALARIES",
  "SALES COMMISSIONS / BONUS",
  "SALES VAC / HOL / SICK",
  "TECHNICIAN SALES COMMISSION",
  "SUBTOTAL SALES PAYROLL",
  "TECHNICIAN SERVICE SALARIES",
  "TECHNICIAN SERV PRODUCTION",
  "PC VAC / HOL / SICK",
  "PC SERV WAGES - OT",
  "SUBTOTAL SERV PAYROLL",
  "SERV MGR SALARY",
  "SERV MGR BONUS",
  "TOTAL SERVICE WAGES",
  "TOTAL PAYROLL",
  "PERSONNEL RELATED",
  "PAYROLL TAXES",
  "INS-GROUP BENEFITS",
  "INS-GROUP DEDUCTIONS",
  "UNIFORMS",
  "MOVING",
  "TRAINING",
  "PROF RECRUITING",
  "MEDICAL",
  "OTHER PERSONNEL RELATED",
  "TOTAL PERSONNEL EXPENSES",
  "TOTAL EMPL COST",
  "MATERIALS AND SUPPLIES",
  "PC CHEMICALS",
  "FREIGHT IN",
  "PC TOOLS & EQUIPMENT",
  "ODOUR/AIRE",
  "M&S FLY LIGHTS",
  "SUB TOTAL M&S",
  "COGS PRODUCTS & EQUIPMENT",
  "TOTAL MATERIAL & SUPPLIES",
  "VEHICLE EXPENSES",
  "GASOLINE",
  "TIRES",
  "OIL CHANGE",
  "OTHER OPERATING EXPENSES",
  "TOTAL VEHICLE OPERATING",
  "VEHICLE STANDING EXPENSES",
  "LEASE",
  "DEPRECIATION",
  "VEH GAIN / LOSS",
  "LICENSES / TAXES",
  "TOTAL STAND EXPENSES",
  "TOTAL VEHICLE EXPENSE",
  "AUTO ALLOWANCE",
  "PER USE DEDUCTIONS",
  "TOTAL FLEET",
  "INSURANCE & CLAIMS",
  "VEHICLE ACCIDENT",
  "CLAIMS - GENERAL  LIABILITY",
  "INS - GENERAL LIABILITY",
  "INS - AUTO LIABILITY",
  "INS - WORKERS COMPENSATION",
  "SUBTOTAL INSURANCE & CLAIMS",
  "CATASTROPHIC ACCRUAL",
  "TOTAL INSURANCE & CLAIMS",
  "BAD DEBTS",
  "BAD DEBT EXPENSE",
  "RECOVERIES",
  "SUBTOTAL BAD DEBTS",
  "BAD DEBT ACCRUAL",
  "OUT OF POLICY",
  "TOTAL BAD DEBTS",
  "OTHER EXPENSES",
  "FIXED EXPENSES",
  "ADVERTISING DIRECT",
  "RENT - BRANCH",
  "DEPRECIATION (fixed)",
  "TAXES PROP/OTHER",
  "TOTAL FIXED EXPENSE",
  "CONTROLLABLE EXPENSES",
  "OFFICE SUPPLIES",
  "PRINTING & FORMS",
  "COMPUTER SUPPLIES",
  "TRAVEL",
  "CONFERENCE",
  "TELEPHONE & UTILITIES",
  "LOCAL CENTRALIZED",
  "LONG DISTANCE CENTRALIZED",
  "CELLULAR TELEPHONE",
  "OTHER COMMUNICATION",
  "SUBTOTAL TELEPHONE",
  "UTILITIES",
  "SUBTOTAL TELE. & UTILITIES",
  "PROFESSIONAL SERVICES",
  "MAINTENANCE & REPAIRS",
  "EQUIPMENT RENTAL",
  "POSTAGE",
  "BANK SERVICE CHARGES",
  "CREDIT CARD SERVICE FEE",
  "MISCELLANEOUS",
  "TOTAL CONTROLLABLE",
  "TOTAL OTHER EXPENSE",
  "TOTAL EXPENSES",
  "CONTRIBUTION B/4 OVERHEAD",
  "OVERHEAD ALLOCATIONS",
  "SALES ALLOCATIONS",
  "QA ALLOCATIONS",
  "AR ALLOCATIONS",
  "DATA PROCESSING ALLOCATIONS",
  "ACCOUNTING ALLOCATIONS",
  "ADVERTISING & MKTG - ALLOCATION",
  "REGION SUPPORT SERVICES",
  "CANADA OVERHEAD ALLOCATIONS",
  "BMT ALLOCATIONS",
  "FLEET ALLOCATIONS",
  "CORPORATE ADMIN ALLOCATIONS",
  "HO ADMIN ALLOCATIONS",
  "HUMAN RESOURCES ALLOCATIONS",
  "INFORMATION TECH. ALLOCATIONS",
  "TOTAL OVERHEAD ALLOCATIONS",
  "OPERATING PROFIT",
  "OVERHEAD ALLOCATION REVERSAL",
  "BONUS OPERATING PROFIT",
  "HOME OFFICE OVERHEAD",
  "ACQUISITION COST",
  "NON RECURRING FEES",
  "ULTIPRO COST",
  "EXTERNAL PROFIT",
]

// Normalize for template matching (handles " - " vs ". " etc.)
export function normForMatch(s: string) {
  return normDesc(s).replace(/[\s\-\.]+/g, " ").replace(/\s+/g, " ").trim()
}

const EXPENSE_PERCENT_START_INDEX = TEMPLATE_ORDER.findIndex(
  (description) => normForMatch(description) === normForMatch("DIVISION MANAGER")
)

function shouldShowExpensePercentage(description: string) {
  const templateIndex = TEMPLATE_ORDER.findIndex(
    (entry) => normForMatch(entry) === normForMatch(description)
  )
  return templateIndex >= EXPENSE_PERCENT_START_INDEX
}

function formatRevenueShare(value: number | undefined, revenue: number | undefined) {
  if (value === undefined || revenue === undefined || Math.abs(revenue) < 0.005) return null
  return `${((value / revenue) * 100).toFixed(1)}%`
}

function isKpiLine(description: string) {
  const d = normDesc(description)
  return d === KPI_REVENUE || KPI_EXPENSE_LINES.has(d)
}

// ── Total Company drill-down: per-branch breakdown on hover ──
type BranchMeta = { id: string; name: string; code: string }
type BranchBreakdownRow = {
  branchId: string
  name: string
  code: string
  forecast: number
  budget: number
  actuals?: number
  revenueForecast?: number
  revenueBudget?: number
  revenueActuals?: number
}

// Cache so re-hovering the same line doesn't refetch. Keyed by
// description + year + month + sorted branch ids (scope changes with region filter).
const breakdownCache = new Map<string, BranchBreakdownRow[]>()

function getPreviousMonthPeriod(year: number, month: number) {
  if (month <= 1) {
    return { year: year - 1, month: 12 }
  }

  return { year, month: month - 1 }
}

function BranchBreakdownContent({
  description,
  summaryBranchIds,
  branchMeta,
  summaryBranchMetrics,
  currentYear,
  currentMonth,
  breakdownVersion,
  onSelectBranch,
}: {
  description: string
  summaryBranchIds: string[]
  branchMeta: BranchMeta[]
  summaryBranchMetrics?: Map<string, Map<string, { forecast: number; budget: number; actuals?: number }>>
  currentYear: number
  currentMonth: number
  breakdownVersion: number
  onSelectBranch?: (branchId: string, description: string) => void
}) {
  const [rows, setRows] = useState<BranchBreakdownRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const previousActualPeriod = useMemo(
    () => getPreviousMonthPeriod(currentYear, currentMonth),
    [currentYear, currentMonth]
  )

  const derivedRows = useMemo(() => {
    if (!summaryBranchMetrics) return null

    return branchMeta
      .filter((b) => summaryBranchIds.includes(b.id))
      .map((b) => {
        const metric = summaryBranchMetrics.get(b.id)?.get(description)
        const revenueMetric = summaryBranchMetrics.get(b.id)?.get(KPI_REVENUE)
        return {
          branchId: b.id,
          name: b.name,
          code: b.code,
          forecast: metric?.forecast ?? 0,
          budget: metric?.budget ?? 0,
          actuals: metric?.actuals,
          revenueForecast: revenueMetric?.forecast,
          revenueBudget: revenueMetric?.budget,
          revenueActuals: revenueMetric?.actuals,
        }
      })
      .sort((a, b) => {
        const na = parseInt(a.code, 10)
        const nb = parseInt(b.code, 10)
        if (!isNaN(na) && !isNaN(nb)) return na - nb
        return a.code.localeCompare(b.code)
      })
  }, [summaryBranchMetrics, branchMeta, summaryBranchIds, description])

  useEffect(() => {
    if (derivedRows) {
      setRows(derivedRows)
      setLoading(false)
      setErrored(false)
      return
    }

    let cancelled = false
    const scopeKey = [...summaryBranchIds].sort().join(",")
    const cacheKey = `${description}|${currentYear}|${currentMonth}|${scopeKey}|${breakdownVersion}`

    const cached = breakdownCache.get(cacheKey)
    if (cached) {
      setRows(cached)
      setLoading(false)
      setErrored(false)
      return
    }

    const run = async () => {
      try {
        const supabase = createClient()
        const [forecastResult, actualsResult] = await Promise.all([
          supabase
            .from("forecasts")
            .select("branch_id, forecast_value, budget_value")
            .in("branch_id", summaryBranchIds)
            .eq("year", currentYear)
            .eq("month", currentMonth)
            .eq("description", description),
          supabase
            .from("last_month_actuals")
            .select("branch_id, value")
            .in("branch_id", summaryBranchIds)
            .eq("year", previousActualPeriod.year)
            .eq("month", previousActualPeriod.month)
            .eq("description", description),
        ])

        if (cancelled) return
        if (forecastResult.error) throw forecastResult.error
        if (actualsResult.error) throw actualsResult.error

        const forecastByBranch = new Map<string, { forecast: number; budget: number }>()
        for (const row of forecastResult.data ?? []) {
          forecastByBranch.set(row.branch_id, {
            forecast: Number(row.forecast_value) || 0,
            budget: Number(row.budget_value) || 0,
          })
        }

        const actualsByBranch = new Map<string, number>()
        for (const row of actualsResult.data ?? []) {
          if (!row.branch_id) continue
          actualsByBranch.set(row.branch_id, Number(row.value) || 0)
        }

        const merged: BranchBreakdownRow[] = branchMeta
          .filter((b) => summaryBranchIds.includes(b.id))
          .map((b) => ({
            branchId: b.id,
            name: b.name,
            code: b.code,
            forecast: forecastByBranch.get(b.id)?.forecast ?? 0,
            budget: forecastByBranch.get(b.id)?.budget ?? 0,
            actuals: actualsByBranch.get(b.id),
          }))
          .sort((a, b) => {
            const na = parseInt(a.code, 10)
            const nb = parseInt(b.code, 10)
            if (!isNaN(na) && !isNaN(nb)) return na - nb
            return a.code.localeCompare(b.code)
          })

        breakdownCache.set(cacheKey, merged)
        if (!cancelled) {
          setRows(merged)
          setErrored(false)
        }
      } catch {
        if (!cancelled) setErrored(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [derivedRows, description, currentYear, currentMonth, summaryBranchIds, branchMeta, breakdownVersion, previousActualPeriod])

  const totals = rows.reduce((sum, row) => ({
    forecast: sum.forecast + row.forecast,
    budget: sum.budget + row.budget,
    actuals: sum.actuals + (row.actuals ?? 0),
    actualsCount: sum.actualsCount + (row.actuals === undefined ? 0 : 1),
  }), { forecast: 0, budget: 0, actuals: 0, actualsCount: 0 })

  const showExpensePercentage = shouldShowExpensePercentage(description)

  const renderBreakdownMetricStack = ({
    value,
    revenue,
    showPercent,
    amountClassName,
  }: {
    value: number | undefined
    revenue: number | undefined
    showPercent: boolean
    amountClassName: string
  }) => {
    const percent = showPercent ? formatRevenueShare(value, revenue) : null

    return (
      <span className="flex min-h-9 flex-col items-end justify-center leading-tight">
        {percent && <span className="text-[10px] text-muted-foreground">{percent}</span>}
        <span className={amountClassName}>{value === undefined ? "-" : formatCurrency(value)}</span>
      </span>
    )
  }

  return (
    <div className="w-[32rem] max-h-[60vh] overflow-y-auto">
      <div className="px-3 py-2 border-b bg-muted sticky top-0">
        <p className="text-sm font-semibold leading-tight">{description}</p>
        <p className="text-[11px] text-muted-foreground">
          Branch breakdown · {getShortMonthName(currentMonth)} {currentYear} · Prev actuals: {getShortMonthName(previousActualPeriod.month)} {previousActualPeriod.year}
        </p>
      </div>

      {loading ? (
        <div className="p-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-5 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : errored ? (
        <p className="p-3 text-sm text-destructive">Could not load branch breakdown.</p>
      ) : rows.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No branches in scope.</p>
      ) : (
        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_96px_96px_96px] gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b bg-background sticky top-[53px]">
            <span>Branch</span>
            <span className="text-right">Forecast</span>
            <span className="text-right">Budget</span>
            <span className="text-right">Prev Actuals</span>
          </div>
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.branchId}>
                <button
                  type="button"
                  disabled={!onSelectBranch}
                  onClick={() => onSelectBranch?.(r.branchId, description)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_96px_96px_96px] gap-2 px-3 py-2 text-left hover:bg-accent transition-colors cursor-pointer disabled:cursor-default"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.name}</span>
                    <span className="block text-[10px] uppercase text-muted-foreground">{r.code}</span>
                  </span>
                  {renderBreakdownMetricStack({
                    value: r.forecast,
                    revenue: r.revenueForecast,
                    showPercent: showExpensePercentage,
                    amountClassName: "text-right text-sm font-semibold tabular-nums",
                  })}
                  {renderBreakdownMetricStack({
                    value: r.budget,
                    revenue: r.revenueBudget,
                    showPercent: showExpensePercentage,
                    amountClassName: "text-right text-sm tabular-nums text-muted-foreground",
                  })}
                  {renderBreakdownMetricStack({
                    value: r.actuals,
                    revenue: r.revenueActuals,
                    showPercent: showExpensePercentage,
                    amountClassName: "text-right text-sm tabular-nums text-muted-foreground",
                  })}
                </button>
              </li>
            ))}
            <li className="grid grid-cols-[minmax(0,1fr)_96px_96px_96px] gap-2 px-3 py-2 bg-muted sticky bottom-0">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total</span>
              <span className="text-right text-sm font-bold tabular-nums">{formatCurrency(totals.forecast)}</span>
              <span className="text-right text-sm font-bold tabular-nums">{formatCurrency(totals.budget)}</span>
              <span className="text-right text-sm font-bold tabular-nums">
                {totals.actualsCount === 0 ? "-" : formatCurrency(totals.actuals)}
              </span>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

type ViewMode = "revenue" | "expenses" | "both"

type ForecastTableProps = {
  forecasts: ForecastResult[]
  currentMonth: number
  onUpdateForecast?: (description: string, month: number, newValue: number) => Promise<void>
  editable?: boolean
  lastMonthActuals?: Map<string, number>
  editedCells?: Set<string>
  monthStatuses?: Record<number, {
    isCompleted: boolean
    completedAt: string | null
    completedByName: string | null
    unlockedAt: string | null
    unlockedByName: string | null
  }>
  lockedMonths?: Set<number>
  onCompleteMonth?: (month: number, note?: string) => Promise<void>
  onUnlockMonth?: (month: number, note?: string) => Promise<void>
  monthActionLoading?: number | null
  workingDaysMap?: Record<number, number>
  onUpdateWorkingDays?: (month: number, days: number) => Promise<void>
  currentYear?: number
  autoScrollKey?: string
  // Total Company drill-down
  isSummary?: boolean
  summaryBranchIds?: string[]
  branchMeta?: BranchMeta[]
  summaryBranchMetrics?: Map<string, Map<string, { forecast: number; budget: number; actuals?: number }>>
  breakdownVersion?: number
  onSelectBranch?: (branchId: string, description: string) => void
}

type EditingCell = {
  description: string
  month: number
  currentValue: number
} | null

export function ForecastTable({
  forecasts,
  currentMonth,
  onUpdateForecast,
  editable = true,
  lastMonthActuals,
  editedCells,
  monthStatuses = {},
  lockedMonths = new Set<number>(),
  onCompleteMonth,
  onUnlockMonth,
  monthActionLoading = null,
  workingDaysMap = {},
  onUpdateWorkingDays,
  currentYear = 2026,
  autoScrollKey,
  isSummary = false,
  summaryBranchIds = [],
  branchMeta = [],
  summaryBranchMetrics,
  breakdownVersion = 0,
  onSelectBranch,
}: ForecastTableProps) {
  const [editingCell, setEditingCell] = useState<EditingCell>(null)
  const [editValue, setEditValue] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [showAllMonths, setShowAllMonths] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>("both")
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(new Set())
  const [sortByTemplate, setSortByTemplate] = useState(true)
  const [confirmCompleteMonth, setConfirmCompleteMonth] = useState<number | null>(null)
  const [confirmUnlockMonth, setConfirmUnlockMonth] = useState<number | null>(null)
  const [actionNote, setActionNote] = useState("")
  const [editingWorkingDaysMonth, setEditingWorkingDaysMonth] = useState<number | null>(null)
  const [editingWorkingDaysValue, setEditingWorkingDaysValue] = useState<string>("")
  const [updatingWorkingDays, setUpdatingWorkingDays] = useState(false)

  // Metric toggles
  const [showForecast, setShowForecast] = useState(true)
  const [showBudget, setShowBudget] = useState(true)
  const [showLastYear, setShowLastYear] = useState(true)
  const [showLastMonth, setShowLastMonth] = useState(true)
  const visibleMetricCount = [showForecast, showBudget, showLastYear, showLastMonth].filter(Boolean).length
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Filter forecasts by view mode
  const filteredForecasts = forecasts.filter((f) => {
    if (viewMode === "revenue") return isRevenueLine(f.description)
    if (viewMode === "expenses") return isExpenseLine(f.description)
    return true
  })

  // Group by description (from filtered forecasts), exclude hidden rows and below-External-Profit items
  const uniqueDescriptions = [...new Set(filteredForecasts.map(f => f.description))]
    .filter(d => !HIDDEN_BELOW_EXTERNAL.has(normDesc(d)))
  const allDescriptions = sortByTemplate
    ? [...uniqueDescriptions].sort((a, b) => {
      const na = normForMatch(a)
      const nb = normForMatch(b)
      const findTemplateIndex = (n: string) => {
        // Prefer exact match to avoid prefix collisions (e.g. "PAYROLL" vs "PAYROLL TAXES")
        const exact = TEMPLATE_ORDER.findIndex((t) => normForMatch(t) === n)
        if (exact !== -1) return exact
        return TEMPLATE_ORDER.findIndex((t) => {
          const nt = normForMatch(t)
          return n.startsWith(nt + " ") || nt.startsWith(n + " ")
        })
      }
      const ia = findTemplateIndex(na)
      const ib = findTemplateIndex(nb)
      if (ia >= 0 && ib >= 0) return ia - ib
      if (ia >= 0) return -1
      if (ib >= 0) return 1
      return a.localeCompare(b)
    })
    : [...uniqueDescriptions].sort((a, b) => a.localeCompare(b))
  const descriptions = allDescriptions.filter((d) => !hiddenRows.has(d))
  const toggleRow = (desc: string) => {
    setHiddenRows((prev) => {
      const next = new Set(prev)
      if (next.has(desc)) next.delete(desc)
      else next.add(desc)
      return next
    })
  }

  // Get months to display: all 12 or only current month
  const months = showAllMonths
    ? Array.from({ length: 12 }, (_, i) => i + 1)
    : [currentMonth]

  useEffect(() => {
    if (!showAllMonths) return

    const scrollContainer = scrollContainerRef.current
    const monthAnchor = scrollContainer?.querySelector<HTMLElement>(`[data-month-anchor="${currentMonth}"]`)
    const stickyDescription = scrollContainer?.querySelector<HTMLElement>("[data-sticky-description]")
    if (!scrollContainer || !monthAnchor) return

    const frame = window.requestAnimationFrame(() => {
      const stickyWidth = stickyDescription?.offsetWidth ?? 220
      const maxScrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth
      const targetScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, monthAnchor.offsetLeft - stickyWidth)
      )

      scrollContainer.scrollTo({ left: targetScrollLeft, behavior: "auto" })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [autoScrollKey, currentMonth, showAllMonths, visibleMetricCount])

  const handleCellClick = (description: string, month: number, currentValue: number) => {
    if (!editable || !onUpdateForecast) return
    setEditingCell({ description, month, currentValue })
    setEditValue(currentValue.toFixed(2))
    setEditDialogOpen(true)
  }

  const handleSave = async () => {
    if (!editingCell || !onUpdateForecast) return

    const newValue = parseFloat(editValue)
    if (isNaN(newValue)) return

    setSaving(true)
    try {
      await onUpdateForecast(editingCell.description, editingCell.month, newValue)
      setEditDialogOpen(false)
      setEditingCell(null)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setEditDialogOpen(false)
    setEditingCell(null)
    setEditValue("")
  }

  const handleRequestCompleteMonth = (month: number) => {
    if (!onCompleteMonth || monthStatuses[month]?.isCompleted || monthActionLoading === month) return
    setActionNote("")
    setConfirmCompleteMonth(month)
  }

  const handleConfirmCompleteMonth = async () => {
    if (!onCompleteMonth || confirmCompleteMonth === null) return

    const month = confirmCompleteMonth
    const note = actionNote
    setConfirmCompleteMonth(null)
    setActionNote("")
    await onCompleteMonth(month, note)
  }

  const handleRequestUnlockMonth = (month: number) => {
    if (!onUnlockMonth || monthActionLoading === month || !monthStatuses[month]?.isCompleted) return
    setActionNote("")
    setConfirmUnlockMonth(month)
  }

  const handleConfirmUnlockMonth = async () => {
    if (!onUnlockMonth || confirmUnlockMonth === null) return

    const month = confirmUnlockMonth
    const note = actionNote
    setConfirmUnlockMonth(null)
    setActionNote("")
    await onUnlockMonth(month, note)
  }

  const handleSaveWorkingDays = async () => {
    if (!onUpdateWorkingDays || editingWorkingDaysMonth === null) return
    const val = parseInt(editingWorkingDaysValue)
    if (isNaN(val) || val < 0 || val > 31) return

    setUpdatingWorkingDays(true)
    try {
      await onUpdateWorkingDays(editingWorkingDaysMonth, val)
      setEditingWorkingDaysMonth(null)
    } finally {
      setUpdatingWorkingDays(false)
    }
  }

  // Restrictive cap for display
  const DISPLAY_CAP = 1000000000 // 1 Billion

  // Total row: sum only leaf items to ensure real-time updates when children are edited
  const totalFilter = (f: ForecastResult) => {
    const d = normDesc(f.description)
    const isLeaf = isLeafDescription(d)
    if (!isLeaf) return false

    if (viewMode === "revenue") return isRevenueLine(d)
    if (viewMode === "expenses") return isExpenseLine(d)
    return true
  }

  const totalNetRevenueRows = forecasts.filter((forecast) => normDesc(forecast.description) === KPI_REVENUE)
  const forecastRevenueByMonth = new Map<number, number>()
  const budgetRevenueByMonth = new Map<number, number>()
  const lastYearRevenueByMonth = new Map<number, number>()

  for (const row of totalNetRevenueRows) {
    forecastRevenueByMonth.set(row.month, row.forecastValue)
    budgetRevenueByMonth.set(row.month, row.budgetValue)
    lastYearRevenueByMonth.set(row.month, row.lastYearValue)
  }

  const lastMonthRevenueByMonth = new Map<number, number>()
  for (let month = 1; month <= 12; month++) {
    const value = lastMonthActuals?.get(`${KPI_REVENUE}\t${month}`)
    if (value !== undefined) lastMonthRevenueByMonth.set(month, value)
  }

  const annualForecastRevenue = totalNetRevenueRows.reduce((sum, row) => sum + row.forecastValue, 0)
  const annualBudgetRevenue = totalNetRevenueRows.reduce((sum, row) => sum + row.budgetValue, 0)

  const renderMetricStack = ({
    value,
    revenue,
    showPercent,
    amountClassName,
    containerClassName = "items-center",
    percentClassName = "text-[10px] text-muted-foreground",
  }: {
    value: number | undefined
    revenue: number | undefined
    showPercent: boolean
    amountClassName: string
    containerClassName?: string
    percentClassName?: string
  }) => {
    const percent = showPercent ? formatRevenueShare(value, revenue) : null

    return (
      <div className={cn("flex min-h-9 flex-col justify-center leading-tight", containerClassName)}>
        {percent && <span className={percentClassName}>{percent}</span>}
        <span className={amountClassName}>{value !== undefined ? formatCurrency(value) : "-"}</span>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Sorting and Rows */}
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">Rows:</Label>
            <div className="flex items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 h-8">
                    <Filter className="h-3.5 w-3.5" />
                    Filters
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 max-h-64 overflow-y-auto" align="start">
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium mb-2">Primary Filter</p>
                      <div className="flex rounded-md border p-0.5 bg-muted/30">
                        <button onClick={() => setViewMode("both")} className={cn("px-2 py-1 text-xs rounded-sm flex-1", viewMode === "both" ? "bg-background shadow" : "")}>All</button>
                        <button onClick={() => setViewMode("revenue")} className={cn("px-2 py-1 text-xs rounded-sm flex-1", viewMode === "revenue" ? "bg-background shadow" : "")}>Rev</button>
                        <button onClick={() => setViewMode("expenses")} className={cn("px-2 py-1 text-xs rounded-sm flex-1", viewMode === "expenses" ? "bg-background shadow" : "")}>Exp</button>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium mb-2">Show/Hide Items</p>
                      {allDescriptions.map((desc) => (
                        <label key={desc} className="flex items-center gap-2 cursor-pointer text-sm py-1">
                          <Checkbox checked={!hiddenRows.has(desc)} onCheckedChange={() => toggleRow(desc)} />
                          <span className="truncate">{desc}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => setSortByTemplate(!sortByTemplate)}
                title={sortByTemplate ? "Sorting by Template order" : "Sorting Alphabetically"}
              >
                {sortByTemplate ? <ListOrdered className="h-4 w-4" /> : <ArrowDownAZ className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Metrics Toggles */}
          <div className="flex items-center gap-2 border-l pl-4 border-border/50">
            <Label className="text-sm text-muted-foreground mr-1">Metrics:</Label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={showForecast} onCheckedChange={(v) => setShowForecast(!!v)} />
                <span className="text-sm font-medium">Forecast</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={showBudget} onCheckedChange={(v) => setShowBudget(!!v)} />
                <span className="text-sm text-muted-foreground">Budget</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={showLastYear} onCheckedChange={(v) => setShowLastYear(!!v)} />
                <span className="text-sm text-muted-foreground">Last Year</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={showLastMonth} onCheckedChange={(v) => setShowLastMonth(!!v)} />
                <span className="text-sm text-muted-foreground">Actuals</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2 border-l pl-4 border-border/50">
            <Switch
              id="show-all-months"
              checked={showAllMonths}
              onCheckedChange={setShowAllMonths}
            />
            <Label htmlFor="show-all-months" className="text-sm font-normal cursor-pointer flex items-center gap-2">
              {showAllMonths ? "All months" : "Selected month"}
            </Label>
          </div>
        </div>
      </div>

        <div ref={scrollContainerRef} className="overflow-auto max-h-[80vh] border rounded-lg text-sm w-0 min-w-full">
          {/* ── Header row 1: Month names ── */}
          <div className="flex w-max min-w-full sticky top-0 z-30 bg-muted border-b font-bold">
            <div data-sticky-description className="w-[220px] min-w-[220px] shrink-0 sticky left-0 z-40 bg-muted px-3 py-2 border-r flex items-center justify-center font-bold shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] whitespace-normal break-words">
              Description
            </div>
            {months.map(month => (
              <div
                key={month}
                data-month-anchor={month}
                className={cn(
                  "shrink-0 text-center px-2 py-2 border-l",
                  month === currentMonth && "border-b-2 border-b-primary"
                )}
                style={{ width: visibleMetricCount * 120 }}
              >
                <div className="flex flex-col items-center gap-1">
                  {onUpdateWorkingDays ? (
                    <button
                      type="button"
                      className="font-bold hover:underline cursor-pointer group/wd flex items-center gap-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1.5 py-0.5"
                      onClick={() => {
                        setEditingWorkingDaysMonth(month)
                        setEditingWorkingDaysValue((workingDaysMap[month] ?? getOntarioWorkingDays(currentYear, month) ?? 0).toString())
                      }}
                      title="Click to edit working days"
                    >
                      <span>{getShortMonthName(month)} ({workingDaysMap[month] ?? getOntarioWorkingDays(currentYear, month) ?? 0} W/D)</span>
                      <Pencil className="h-3 w-3 opacity-60 group-hover/wd:opacity-100 transition-opacity text-primary shrink-0" />
                    </button>
                  ) : (
                    <span className="font-bold px-1.5 py-0.5">
                      {getShortMonthName(month)} ({workingDaysMap[month] ?? getOntarioWorkingDays(currentYear, month) ?? 0} W/D)
                    </span>
                  )}
                  <div className="min-h-[24px] flex items-center justify-center gap-2 text-[11px] font-normal text-muted-foreground">
                    {/* Check isCompleted FIRST so users with both lock and
                        unlock permission (region admins) can see the unlock
                        button after locking. Previously onCompleteMonth was
                        checked first, which short-circuited the unlock path
                        for any role that could also lock. */}
                    {monthStatuses[month]?.isCompleted ? (
                      <>
                        <Badge variant="default" className="text-[10px] uppercase tracking-wide">
                          Forecasted
                        </Badge>
                        {onUnlockMonth && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            disabled={monthActionLoading === month}
                            onClick={() => handleRequestUnlockMonth(month)}
                          >
                            {monthActionLoading === month ? <Loader2 className="h-3 w-3 animate-spin" /> : "Unlock"}
                          </Button>
                        )}
                      </>
                    ) : onCompleteMonth ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={monthActionLoading === month}
                        onClick={() => handleRequestCompleteMonth(month)}
                      >
                        <Checkbox
                          checked={monthStatuses[month]?.isCompleted ?? false}
                          className="pointer-events-none"
                          disabled={monthActionLoading === month}
                          aria-hidden="true"
                        />
                        <span>Forecasted</span>
                      </button>
                    ) : monthStatuses[month]?.unlockedAt ? (
                      <span>Open for rework</span>
                    ) : (
                      <span>Open</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {(showForecast || showBudget) && (
              <div className="shrink-0 text-center py-2 border-l bg-muted" style={{ width: [showForecast, showBudget].filter(Boolean).length * 120 }}>
                Annual Total
              </div>
            )}
          </div>

          {/* ── Header row 2: Metric sub-headers ── */}
          <div className="flex w-max min-w-full sticky top-[37px] z-30 bg-muted border-b text-xs">
            <div className="w-[220px] min-w-[220px] shrink-0 sticky left-0 z-40 bg-muted border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" />
            {months.map(month => (
              <Fragment key={month}>
                {showForecast && <div className={cn("shrink-0 w-[120px] text-center font-medium px-2 py-2 border-l", month === currentMonth && "border-b-2 border-b-primary")}>Forecast</div>}
                {showBudget && <div className={cn("shrink-0 w-[120px] text-center font-medium text-muted-foreground px-2 py-2", month === currentMonth && "border-b-2 border-b-primary")}>Budget</div>}
                {showLastYear && <div className={cn("shrink-0 w-[120px] text-center font-medium text-muted-foreground px-2 py-2", month === currentMonth && "border-b-2 border-b-primary")}>Last Year</div>}
                {showLastMonth && <div className={cn("shrink-0 w-[120px] text-center font-medium text-muted-foreground px-2 py-2", month === currentMonth && "border-b-2 border-b-primary")}>Actuals</div>}
              </Fragment>
            ))}
            {showForecast && <div className="shrink-0 w-[120px] text-center font-medium px-2 py-2 border-l">Forecast</div>}
            {showBudget && <div className="shrink-0 w-[120px] text-center font-medium text-muted-foreground px-2 py-2">Budget</div>}
          </div>

          {/* ── Data rows ── */}
          {descriptions.map((description, idx) => {
            const descForecasts = filteredForecasts.filter(f => f.description === description)
            const ytdForecast = descForecasts.reduce((sum, f) => sum + f.forecastValue, 0)
            const ytdBudget = descForecasts.reduce((sum, f) => sum + f.budgetValue, 0)
            const showExpensePercentage = shouldShowExpensePercentage(description)
            const isEven = idx % 2 === 0
            const rowBg = isEven ? "bg-background" : "bg-secondary"

            return (
              <div
                key={description}
                className={cn("flex w-max min-w-full border-b group transition-colors", rowBg)}
              >
                {isSummary ? (
                  <HoverCard openDelay={100} closeDelay={200}>
                    <HoverCardTrigger asChild>
                      <div className={cn("w-[220px] min-w-[220px] shrink-0 sticky left-0 z-20 px-3 py-3 border-r font-medium shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] whitespace-normal break-words cursor-help", isEven ? "bg-background" : "bg-secondary", "group-hover:bg-accent")}>
                        <span className={cn("underline decoration-dotted underline-offset-4 decoration-muted-foreground/50", isSubtotalDescription(description) && "font-bold text-foreground")}>
                          {description}
                        </span>
                      </div>
                    </HoverCardTrigger>
                    <HoverCardContent side="right" align="start" className="w-auto p-0">
                      <BranchBreakdownContent
                        description={description}
                        summaryBranchIds={summaryBranchIds}
                        branchMeta={branchMeta}
                        summaryBranchMetrics={summaryBranchMetrics}
                        currentYear={currentYear}
                        currentMonth={currentMonth}
                        breakdownVersion={breakdownVersion}
                        onSelectBranch={onSelectBranch}
                      />
                    </HoverCardContent>
                  </HoverCard>
                ) : (
                  <div className={cn("w-[220px] min-w-[220px] shrink-0 sticky left-0 z-20 px-3 py-3 border-r font-medium shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] whitespace-normal break-words", isEven ? "bg-background" : "bg-secondary", "group-hover:bg-accent")}>
                    <span className={cn(isSubtotalDescription(description) && "font-bold text-foreground")}>
                      {description}
                    </span>
                  </div>
                )}
                {months.map(month => {
                  const f = descForecasts.find(m => m.month === month)
                  const lastMonthValue = lastMonthActuals?.get(`${description}\t${month}`)
                  const isCurrent = month === currentMonth
                  const isLocked = lockedMonths.has(month)
                  const isClickable = editable && onUpdateForecast && f && !isLocked && isLeafDescription(description) && !BUDGET_ONLY_DESCS.has(normDesc(description)) && !NON_EDITABLE_SUBTOTALS.has(normDesc(description))
                  const isEdited = f && editedCells?.has(`${description}\t${month}`)

                  return (
                    <Fragment key={month}>
                      {showForecast && (
                        <div
                          className={cn(
                            "shrink-0 w-[120px] text-center p-2 relative group/cell border-l",
                            isCurrent && "bg-primary/5",
                            isLocked && "bg-emerald-50/70 dark:bg-emerald-950/20",
                            isClickable && "cursor-pointer hover:bg-muted/40 transition-colors"
                          )}
                          onClick={() => isClickable && handleCellClick(description, month, f.forecastValue)}
                        >
                          {renderMetricStack({
                            value: f?.forecastValue,
                            revenue: forecastRevenueByMonth.get(month),
                            showPercent: showExpensePercentage,
                            amountClassName: cn("text-xs font-semibold", isEdited && "text-violet-600 dark:text-violet-400"),
                          })}
                          {isClickable && (
                            <Pencil className="h-2.5 w-2.5 absolute top-1 right-1 opacity-0 group-hover/cell:opacity-30" />
                          )}
                        </div>
                      )}
                      {showBudget && (
                        <div className={cn("shrink-0 w-[120px] text-center p-2 text-muted-foreground", isCurrent && "bg-primary/5")}>
                          {renderMetricStack({
                            value: f?.budgetValue,
                            revenue: budgetRevenueByMonth.get(month),
                            showPercent: showExpensePercentage,
                            amountClassName: "text-xs",
                          })}
                        </div>
                      )}
                      {showLastYear && (
                        <div className={cn("shrink-0 w-[120px] text-center p-2 text-muted-foreground", isCurrent && "bg-primary/5")}>
                          {renderMetricStack({
                            value: f?.lastYearValue,
                            revenue: lastYearRevenueByMonth.get(month),
                            showPercent: showExpensePercentage,
                            amountClassName: "text-xs",
                          })}
                        </div>
                      )}
                      {showLastMonth && (
                        <div className={cn("shrink-0 w-[120px] text-center p-2 text-muted-foreground", isCurrent && "bg-primary/5")}>
                          {renderMetricStack({
                            value: lastMonthValue,
                            revenue: lastMonthRevenueByMonth.get(month),
                            showPercent: showExpensePercentage,
                            amountClassName: "text-xs",
                          })}
                        </div>
                      )}
                    </Fragment>
                  )
                })}
                {showForecast && (
                  <div className="shrink-0 w-[120px] text-right font-bold p-2 bg-muted/10 border-l">
                    {renderMetricStack({
                      value: ytdForecast,
                      revenue: annualForecastRevenue,
                      showPercent: showExpensePercentage,
                      amountClassName: "text-sm font-bold",
                      containerClassName: "items-end",
                    })}
                  </div>
                )}
                {showBudget && (
                  <div className="shrink-0 w-[120px] text-right font-bold p-2 bg-muted/10 text-muted-foreground">
                    {renderMetricStack({
                      value: ytdBudget,
                      revenue: annualBudgetRevenue,
                      showPercent: showExpensePercentage,
                      amountClassName: "text-sm font-bold",
                      containerClassName: "items-end",
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Grand Total row ── */}
          <div className="flex w-max min-w-full border-t-2 bg-muted font-bold">
            <div className="w-[220px] min-w-[220px] shrink-0 sticky left-0 z-20 bg-muted px-3 py-3 border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] whitespace-normal break-words">
              <div className="flex flex-col">
                <span>Grand Total</span>
                <span className="text-[10px] font-normal text-muted-foreground uppercase tracking-tight">
                  {viewMode === "both" ? "Rev + Exp" : viewMode}
                </span>
              </div>
            </div>
            {months.map(month => {
              const monthF = forecasts.filter(f => f.month === month && totalFilter(f)).reduce((sum, f) => sum + f.forecastValue, 0)
              const monthB = forecasts.filter(f => f.month === month && totalFilter(f)).reduce((sum, f) => sum + f.budgetValue, 0)
              return (
                <Fragment key={month}>
                  {showForecast && (
                    <div className={cn("shrink-0 w-[120px] text-center p-2 border-l", month === currentMonth && "bg-primary/5")}>
                      <span className="text-xs">{formatCurrency(monthF)}</span>
                    </div>
                  )}
                  {showBudget && (
                    <div className={cn("shrink-0 w-[120px] text-center p-2 text-muted-foreground", month === currentMonth && "bg-primary/5")}>
                      <span className="text-xs">{formatCurrency(monthB)}</span>
                    </div>
                  )}
                  {showLastYear && (
                    <div className={cn("shrink-0 w-[120px] text-center p-2 text-muted-foreground", month === currentMonth && "bg-primary/5")}>
                      <span className="text-xs">{formatCurrency(forecasts.filter(f => f.month === month && totalFilter(f)).reduce((sum, f) => sum + f.lastYearValue, 0))}</span>
                    </div>
                  )}
                  {showLastMonth && (
                    <div className={cn("shrink-0 w-[120px] text-center p-2 text-muted-foreground", month === currentMonth && "bg-primary/5")}>
                      <span className="text-xs">-</span>
                    </div>
                  )}
                </Fragment>
              )
            })}
            {showForecast && (
              <div className="shrink-0 w-[120px] text-right p-2 bg-muted/20 border-l">
                {formatCurrency(forecasts.filter(f => totalFilter(f)).reduce((sum, f) => sum + f.forecastValue, 0))}
              </div>
            )}
            {showBudget && (
              <div className="shrink-0 w-[120px] text-right p-2 bg-muted/20 text-muted-foreground">
                {formatCurrency(forecasts.filter(f => totalFilter(f)).reduce((sum, f) => sum + f.budgetValue, 0))}
              </div>
            )}
          </div>
        </div>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Forecast</DialogTitle>
            <DialogDescription>
              {editingCell && (
                <>
                  Modify the forecast value for <strong>{editingCell.description}</strong> in{" "}
                  <strong>{getShortMonthName(editingCell.month)}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="forecast-value">Forecast Value</Label>
              <Input
                id="forecast-value"
                type="number"
                step="0.01"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave()
                  if (e.key === "Escape") handleCancel()
                }}
                autoFocus
              />
            </div>
            {editingCell && (
              <div className="text-sm text-muted-foreground space-y-1">
                <p>Original value: {formatCurrency(editingCell.currentValue)}</p>
                {editValue && !isNaN(parseFloat(editValue)) && (
                  <p>
                    Change: {" "}
                    <span className={parseFloat(editValue) >= editingCell.currentValue ? "text-accent" : "text-destructive"}>
                      {parseFloat(editValue) >= editingCell.currentValue ? "+" : ""}
                      {formatCurrency(parseFloat(editValue) - editingCell.currentValue)}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel} disabled={saving}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !editValue || isNaN(parseFloat(editValue))}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmCompleteMonth !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmCompleteMonth(null)
            setActionNote("")
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark month as forecasted?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCompleteMonth !== null
                ? `You are about to finalize ${getShortMonthName(confirmCompleteMonth)}.`
                : "You are about to finalize this month."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="space-y-2">
              <p>This will mark the month as forecasted for your branch.</p>
              <p>All forecast cells for that month will be locked immediately after confirmation.</p>
              <p>You will not be able to make further changes unless HQ unlocks the month for rework.</p>
            </div>
            <div className="space-y-1.5 pt-2">
              <label htmlFor="complete-note" className="text-xs font-semibold text-foreground">
                Optional Note / Comments
              </label>
              <Textarea
                id="complete-note"
                placeholder="Provide details or comments (optional)..."
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                className="min-h-16 text-sm"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmCompleteMonth !== null && monthActionLoading === confirmCompleteMonth}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmCompleteMonth !== null && monthActionLoading === confirmCompleteMonth}
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmCompleteMonth()
              }}
            >
              {confirmCompleteMonth !== null && monthActionLoading === confirmCompleteMonth ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Confirming...
                </>
              ) : (
                "Confirm"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmUnlockMonth !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmUnlockMonth(null)
            setActionNote("")
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock this month for rework?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmUnlockMonth !== null
                ? `You are about to reopen ${getShortMonthName(confirmUnlockMonth)} for edits.`
                : "You are about to reopen this month for edits."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="space-y-2">
              <p>This will remove the forecasted lock for the selected month.</p>
              <p>Branch users will be able to edit forecast cells for that month again.</p>
              <p>The month will remain open until it is marked forecasted again.</p>
            </div>
            <div className="space-y-1.5 pt-2">
              <label htmlFor="unlock-note" className="text-xs font-semibold text-foreground">
                Optional Note / Reason
              </label>
              <Textarea
                id="unlock-note"
                placeholder="Reason for unlocking this month (optional)..."
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                className="min-h-16 text-sm"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmUnlockMonth !== null && monthActionLoading === confirmUnlockMonth}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmUnlockMonth !== null && monthActionLoading === confirmUnlockMonth}
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmUnlockMonth()
              }}
            >
              {confirmUnlockMonth !== null && monthActionLoading === confirmUnlockMonth ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Unlocking...
                </>
              ) : (
                "Unlock"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={editingWorkingDaysMonth !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingWorkingDaysMonth(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              Edit Working Days for {editingWorkingDaysMonth ? getShortMonthName(editingWorkingDaysMonth) : ""}
            </DialogTitle>
            <DialogDescription>
              Override the number of working days for this month. This change will apply globally.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="working-days-input">Working Days</Label>
              <Input
                id="working-days-input"
                type="number"
                min="0"
                max="31"
                value={editingWorkingDaysValue}
                onChange={(e) => setEditingWorkingDaysValue(e.target.value)}
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingWorkingDaysMonth(null)}
              disabled={updatingWorkingDays}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveWorkingDays}
              disabled={
                updatingWorkingDays ||
                !editingWorkingDaysValue ||
                isNaN(parseInt(editingWorkingDaysValue)) ||
                parseInt(editingWorkingDaysValue) < 0 ||
                parseInt(editingWorkingDaysValue) > 31
              }
            >
              {updatingWorkingDays ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
