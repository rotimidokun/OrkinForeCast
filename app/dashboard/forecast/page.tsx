"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { LineChart, Download, Upload, TrendingUp, TrendingDown, Loader2, AlertCircle, Pencil, Search, ChevronDown } from "lucide-react"
import {
  formatCurrency,
  formatPercent,
  getShortMonthName,
  normDesc,
  isRevenueLine,
  isExpenseLine,
  isSubtotalDescription,
  isLeafDescription,
  type ForecastResult
} from "@/lib/forecasting"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import * as XLSX from "xlsx"
import { ForecastChart, ForecastBarChart } from "@/components/dashboard/forecast-chart"
import { ForecastTable, TEMPLATE_ORDER, HIDDEN_BELOW_EXTERNAL, normForMatch } from "@/components/dashboard/forecast-table"

type Branch = {
  id: string
  name: string
  code: string
  region_id: string
  regions?: { name: string } | null
}

type Profile = {
  role: string
  branch_id: string | null
  region_id: string | null
}

type BranchAccessRow = {
  branch_id: string
  branches: {
    id: string
    name: string
    code: string
    region_id: string
    regions?: { name: string }[] | { name: string } | null
  }[] | {
    id: string
    name: string
    code: string
    region_id: string
    regions?: { name: string }[] | { name: string } | null
  } | null
}

type ForecastMonthStatusRow = {
  month: number
  is_completed: boolean
  completed_at: string | null
  completed_by: string | null
  unlocked_at: string | null
  unlocked_by: string | null
}

type ForecastMonthStatus = {
  isCompleted: boolean
  completedAt: string | null
  completedByName: string | null
  unlockedAt: string | null
  unlockedByName: string | null
}

// Snapshot of a loaded forecast scope so Back/forward navigation can restore instantly.
type CachedForecast = {
  forecasts: ForecastResult[]
  rawForecastRows: { branch_id: string; description: string; month: number; forecast_value: number; budget_value: number }[]
  summaryActualRows: { branch_id: string; description: string; year: number; month: number; value: number }[]
  monthStatuses: Record<number, ForecastMonthStatus>
  editedCells: Set<string>
}

type SummaryBranchMetric = {
  forecast: number
  budget: number
  actuals?: number
}

function buildScopeKey(selectedBranch: string, selectedRegionId: string, currentYear: number, currentMonth: number, branchCount: number) {
  return `${selectedBranch}-${selectedRegionId}-${currentYear}-${currentMonth}-${branchCount}`
}

function normalizeAssignedBranches(rows: BranchAccessRow[]): Branch[] {
  const byId = new Map<string, Branch>()

  rows.forEach((row) => {
    const branch = Array.isArray(row.branches) ? (row.branches[0] ?? null) : row.branches
    if (!branch) return
    byId.set(branch.id, {
      id: branch.id,
      name: branch.name,
      code: branch.code,
      region_id: branch.region_id,
      regions: Array.isArray(branch.regions) ? (branch.regions[0] ?? null) : branch.regions ?? null,
    })
  })

  return [...byId.values()]
}

const ALL_BRANCHES_ID = "__all__" // HQ/region summary view (sum of forecasts from all branches)
const ALL_REGIONS_ID = "__all_regions__" // HQ view: all regions (HQ total); Select cannot use ""

const KPI_REVENUE = "TOTAL NET REVENUE"
const KPI_EXPENSE_LINES = new Set(["TOTAL EXPENSES", "TOTAL OVERHEAD ALLOCATIONS"])

// ────────────────────────────────────────────────────────────────
// Overhead allocation lines — statutory/fixed, use budget figures
// ────────────────────────────────────────────────────────────────
const BUDGET_ONLY_LINES = new Set([
  // Overhead allocations (statutory/fixed)
  "SALES ALLOCATIONS", "QA ALLOCATIONS", "AR ALLOCATIONS",
  "DATA PROCESSING ALLOCATIONS", "ACCOUNTING ALLOCATIONS",
  "ADVERTISING & MKTG - ALLOCATION", "REGION SUPPORT SERVICES",
  "CANADA OVERHEAD ALLOCATIONS", "BMT ALLOCATIONS",
  "FLEET ALLOCATIONS", "CORPORATE ADMIN ALLOCATIONS",
  "HO ADMIN ALLOCATIONS", "HUMAN RESOURCES ALLOCATIONS",
  "INFORMATION TECH. ALLOCATIONS",
  // Below-the-line statutory items
  "OVERHEAD ALLOCATION REVERSAL",
  "HOME OFFICE OVERHEAD",
  "ACQUISITION COST",
  "ULTIPRO COST",
].map(normDesc))

// Below-the-line descriptions that should NOT count as "Total Expenses" for Contribution B/4 Overhead
const BELOW_THE_LINE = new Set([
  ...BUDGET_ONLY_LINES,
  ..."OVERHEAD ALLOCATIONS,TOTAL OVERHEAD ALLOCATIONS,OPERATING PROFIT,OVERHEAD ALLOCATION REVERSAL,BONUS OPERATING PROFIT,HOME OFFICE OVERHEAD,ACQUISITION COST,ULTIPRO COST,EXTERNAL PROFIT,FOREIGN EXCHANGE GAIN/LOSS,ROYALTY FEES,INTEREST EXPENSE ORKIN,CANADIAN TAXES,NON-OP INT EXP/(REV),NET PROFIT,CONTRIBUTION B/4 OVERHEAD".split(",").map(s => normDesc(s)),
])

// ────────────────────────────────────────────────────────────────
// Hierarchical P&L subtotal rules — order matters (children first)
// ────────────────────────────────────────────────────────────────
type SubtotalRule = { desc: string; add: string[]; sub?: string[] }

const SUBTOTAL_RULES: SubtotalRule[] = [
  // Revenue
  { desc: "SUBTOTAL MONTHLY", add: ["PEST CONTROL REVENUE", "COMMERCIAL REVENUE", "COMMERCIAL BED BUG REVENUE (recur)", "FLY CONTROL", "ORKIN/AIRE", "FEMININE HYGIENE", "DRAIN MAINTENANCE", "SOAK TANK"] },
  { desc: "SUBTOTAL/ALTERNATE/SEASONAL", add: ["RESIDENTIAL CONTRACT", "VALU PLUS COMM REVENUE", "SEASONAL REV  & OTHER"] },
  { desc: "GROSS CONTRACT REVENUE", add: ["SUBTOTAL MONTHLY", "SUBTOTAL/ALTERNATE/SEASONAL"] },
  { desc: "TOTAL ALLOWANCES", add: ["ALLOWANCES", "PC COMM MGMT FAILURE", "RESIDENTIAL MGMT FAILURE", "YEAR IN ADVANCE", "PC SALES DISC"] },
  { desc: "NET CONTRACT REVENUE", add: ["GROSS CONTRACT REVENUE", "TOTAL ALLOWANCES"] },
  { desc: "TOTAL MISC REVENUE", add: ["MISCELLANEOUS REVENUE", "RESIDENTIAL BED BUG REVENUE", "COMMERCIAL BED BUG REVENUE", "RESIDENTIAL SPECIAL SERVICES", "COMMERCIAL SPECIAL SERVICES", "PRODUCT SALES", "FUMIGATION PC"] },
  { desc: "TOTAL NET PC REVENUE", add: ["NET CONTRACT REVENUE", "TOTAL MISC REVENUE"] },
  { desc: "TOTAL NET TC REVENUE", add: ["TERMITE (TC) REVENUE", "TERMITE TREATING", "PRETREAT", "INSPECTION FEES", "TC MGMT FAILURE"] },
  { desc: "TOTAL NET REVENUE", add: ["TOTAL NET PC REVENUE", "TOTAL NET TC REVENUE"] },
  // Payroll
  { desc: "SUBTOTALS MANAGERS", add: ["DIVISION MANAGER", "REGION MANAGER SALARY", "BRANCH MANAGER SALARY", "QUALITY ASSURANCE", "MANAGER TRAINEE"] },
  { desc: "SUBTOTAL MGR INCENTIVES", add: ["MANAGERS INCENTIVES PAID", "MGR INCENTIVE ACCRUED"] },
  { desc: "SUBTOTAL OFFICE", add: ["OFFICE SALARIES", "VAC / HOLIDAY / SICK", "OFFICE SAL FLD OT", "TEMP OFFICE PERS"] },
  { desc: "SUBTOTAL ADMIN PAYROLL", add: ["SUBTOTALS MANAGERS", "SUBTOTAL MGR INCENTIVES", "SUBTOTAL OFFICE"] },
  { desc: "SUBTOTAL SALES PAYROLL", add: ["SALESPERSON SALARIES", "ASM & NATIONAL SALES SALARIES", "SALES COMMISSIONS / BONUS", "SALES VAC / HOL / SICK", "TECHNICIAN SALES COMMISSION"] },
  { desc: "SUBTOTAL SERV PAYROLL", add: ["TECHNICIAN SERVICE SALARIES", "TECHNICIAN SERV PRODUCTION", "PC VAC / HOL / SICK", "PC SERV WAGES - OT"] },
  { desc: "TOTAL SERVICE WAGES", add: ["SUBTOTAL SERV PAYROLL", "SERV MGR SALARY", "SERV MGR BONUS"] },
  { desc: "TOTAL PAYROLL", add: ["SUBTOTAL ADMIN PAYROLL", "SUBTOTAL SALES PAYROLL", "TOTAL SERVICE WAGES"] },
  // Personnel related
  { desc: "TOTAL PERSONNEL EXPENSES", add: ["PAYROLL TAXES", "INS-GROUP BENEFITS", "INS-GROUP DEDUCTIONS", "UNIFORMS", "MOVING", "TRAINING", "PROF RECRUITING", "MEDICAL", "OTHER PERSONNEL RELATED"] },
  { desc: "TOTAL EMPL COST", add: ["TOTAL PAYROLL", "TOTAL PERSONNEL EXPENSES"] },
  // Materials
  { desc: "SUB TOTAL M&S", add: ["PC CHEMICALS", "FREIGHT IN", "PC TOOLS & EQUIPMENT", "ODOUR/AIRE", "M&S FLY LIGHTS"] },
  { desc: "TOTAL MATERIAL & SUPPLIES", add: ["SUB TOTAL M&S", "COGS PRODUCTS & EQUIPMENT"] },
  // Vehicle
  { desc: "TOTAL VEHICLE OPERATING", add: ["GASOLINE", "TIRES", "OIL CHANGE", "OTHER OPERATING EXPENSES"] },
  { desc: "TOTAL STAND EXPENSES", add: ["LEASE", "DEPRECIATION", "VEH GAIN / LOSS", "LICENSES / TAXES"] },
  { desc: "TOTAL VEHICLE EXPENSE", add: ["TOTAL VEHICLE OPERATING", "TOTAL STAND EXPENSES"] },
  { desc: "TOTAL FLEET", add: ["TOTAL VEHICLE EXPENSE", "AUTO ALLOWANCE", "PER USE DEDUCTIONS"] },
  // Insurance
  { desc: "SUBTOTAL INSURANCE & CLAIMS", add: ["VEHICLE ACCIDENT", "CLAIMS - GENERAL  LIABILITY", "INS - GENERAL LIABILITY", "INS - AUTO LIABILITY", "INS - WORKERS COMPENSATION"] },
  { desc: "TOTAL INSURANCE & CLAIMS", add: ["SUBTOTAL INSURANCE & CLAIMS", "CATASTROPHIC ACCRUAL"] },
  // Bad debts
  { desc: "SUBTOTAL BAD DEBTS", add: ["BAD DEBT EXPENSE", "RECOVERIES"] },
  { desc: "TOTAL BAD DEBTS", add: ["SUBTOTAL BAD DEBTS", "BAD DEBT ACCRUAL", "OUT OF POLICY"] },
  // Other expenses
  { desc: "TOTAL FIXED EXPENSE", add: ["ADVERTISING DIRECT", "RENT - BRANCH", "DEPRECIATION (fixed)", "TAXES PROP/OTHER"] },
  { desc: "SUBTOTAL TELEPHONE", add: ["LOCAL CENTRALIZED", "LONG DISTANCE CENTRALIZED", "CELLULAR TELEPHONE", "OTHER COMMUNICATION"] },
  { desc: "SUBTOTAL TELE. & UTILITIES", add: ["SUBTOTAL TELEPHONE", "UTILITIES"] },
  { desc: "TOTAL CONTROLLABLE", add: ["OFFICE SUPPLIES", "PRINTING & FORMS", "COMPUTER SUPPLIES", "TRAVEL", "CONFERENCE", "SUBTOTAL TELE. & UTILITIES", "PROFESSIONAL SERVICES", "MAINTENANCE & REPAIRS", "EQUIPMENT RENTAL", "POSTAGE", "BANK SERVICE CHARGES", "CREDIT CARD SERVICE FEE", "MISCELLANEOUS"] },
  { desc: "TOTAL OTHER EXPENSE", add: ["TOTAL FIXED EXPENSE", "TOTAL CONTROLLABLE"] },
  // Total expenses
  { desc: "TOTAL EXPENSES", add: ["TOTAL EMPL COST", "TOTAL MATERIAL & SUPPLIES", "TOTAL FLEET", "TOTAL INSURANCE & CLAIMS", "TOTAL BAD DEBTS", "TOTAL OTHER EXPENSE"] },
  // Contribution
  { desc: "CONTRIBUTION B/4 OVERHEAD", add: ["TOTAL NET REVENUE"], sub: ["TOTAL EXPENSES"] },
  // Overhead
  { desc: "TOTAL OVERHEAD ALLOCATIONS", add: ["SALES ALLOCATIONS", "QA ALLOCATIONS", "AR ALLOCATIONS", "DATA PROCESSING ALLOCATIONS", "ACCOUNTING ALLOCATIONS", "ADVERTISING & MKTG - ALLOCATION", "REGION SUPPORT SERVICES", "CANADA OVERHEAD ALLOCATIONS", "BMT ALLOCATIONS", "FLEET ALLOCATIONS", "CORPORATE ADMIN ALLOCATIONS", "HO ADMIN ALLOCATIONS", "HUMAN RESOURCES ALLOCATIONS", "INFORMATION TECH. ALLOCATIONS"] },
  // Bottom line
  { desc: "OPERATING PROFIT", add: ["CONTRIBUTION B/4 OVERHEAD"], sub: ["TOTAL OVERHEAD ALLOCATIONS"] },
  { desc: "BONUS OPERATING PROFIT", add: ["OPERATING PROFIT"], sub: ["OVERHEAD ALLOCATION REVERSAL"] },
  { desc: "EXTERNAL PROFIT", add: ["BONUS OPERATING PROFIT"], sub: ["HOME OFFICE OVERHEAD", "ACQUISITION COST", "ULTIPRO COST"] },
  { desc: "NET PROFIT", add: ["EXTERNAL PROFIT"], sub: ["FOREIGN EXCHANGE GAIN/LOSS", "ROYALTY FEES", "INTEREST EXPENSE ORKIN", "CANADIAN TAXES", "NON-OP INT EXP/(REV)"] },
]

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Recompute all subtotal/total rows from their children so every displayed
 * metric is derived from the same leaf rows in both branch and HQ summary views.
 * Also overrides overhead allocation forecast values with budget (statutory/fixed).
 */
function recomputeAllSubtotals(forecasts: ForecastResult[]): ForecastResult[] {
  if (forecasts.length === 0) return forecasts
  const result = forecasts.map(f => {
    // Step 1: Override statutory/fixed items forecast with budget
    if (BUDGET_ONLY_LINES.has(normDesc(f.description))) {
      return { ...f, forecastValue: f.budgetValue, variance: 0, variancePercent: 0 }
    }
    return { ...f }
  })

  // Step 2: Recompute the full subtotal hierarchy month-by-month.
  const months = [...new Set(result.map(f => f.month))]

  for (const month of months) {
    const descMap = new Map<string, number>()
    result.forEach((f, i) => {
      if (f.month === month) descMap.set(normDesc(f.description), i)
    })

    for (const rule of SUBTOTAL_RULES) {
      const key = normDesc(rule.desc)
      const idx = descMap.get(key)
      if (idx === undefined) continue

      let forecastSum = 0
      let budgetSum = 0
      let actualSum = 0
      let lastMonthSum = 0
      let lastYearSum = 0

      for (const child of rule.add) {
        const childIndex = descMap.get(normDesc(child))
        if (childIndex === undefined) continue
        forecastSum += result[childIndex].forecastValue
        budgetSum += result[childIndex].budgetValue
        actualSum += result[childIndex].actualValue ?? 0
        lastMonthSum += result[childIndex].lastMonthValue
        lastYearSum += result[childIndex].lastYearValue
      }

      if (rule.sub) {
        for (const child of rule.sub) {
          const childIndex = descMap.get(normDesc(child))
          if (childIndex === undefined) continue
          forecastSum -= result[childIndex].forecastValue
          budgetSum -= result[childIndex].budgetValue
          actualSum -= result[childIndex].actualValue ?? 0
          lastMonthSum -= result[childIndex].lastMonthValue
          lastYearSum -= result[childIndex].lastYearValue
        }
      }

      const forecastValue = roundMoney(forecastSum)
      const budgetValue = roundMoney(budgetSum)
      const actualValue = roundMoney(actualSum)
      const lastMonthValue = roundMoney(lastMonthSum)
      const lastYearValue = roundMoney(lastYearSum)
      const variance = roundMoney(forecastValue - budgetValue)

      result[idx] = {
        ...result[idx],
        forecastValue,
        budgetValue,
        actualValue,
        lastMonthValue,
        lastYearValue,
        variance,
        variancePercent: budgetValue !== 0 ? roundMoney(((forecastValue - budgetValue) / budgetValue) * 100) : 0,
      }
    }
  }

  // Step 3: Ensure non-subtotal rows keep a variance that matches their current values.
  for (let i = 0; i < result.length; i++) {
    const fv = result[i].forecastValue
    const bv = result[i].budgetValue
    const variance = roundMoney(fv - bv)
    result[i] = {
      ...result[i],
      variance,
      variancePercent: bv !== 0 ? roundMoney(((fv - bv) / bv) * 100) : 0,
    }
  }

  return result
}

function recomputeSubtotalMetricMap(source: Map<string, number>): Map<string, number> {
  if (source.size === 0) return source

  const result = new Map(source)

  for (let month = 1; month <= 12; month++) {
    for (const rule of SUBTOTAL_RULES) {
      const targetKey = `${rule.desc}\t${month}`
      const childKeys = [
        ...rule.add.map((child) => `${child}\t${month}`),
        ...(rule.sub ?? []).map((child) => `${child}\t${month}`),
      ]
      const shouldDerive = result.has(targetKey) || childKeys.some((key) => result.has(key))
      if (!shouldDerive) continue

      let total = 0
      for (const child of rule.add) {
        total += result.get(`${child}\t${month}`) ?? 0
      }
      if (rule.sub) {
        for (const child of rule.sub) {
          total -= result.get(`${child}\t${month}`) ?? 0
        }
      }

      result.set(targetKey, roundMoney(total))
    }
  }

  return result
}

function applyBudgetOnlyForecastOverrides(
  forecastSource: Map<string, number>,
  budgetSource: Map<string, number>
): Map<string, number> {
  if (forecastSource.size === 0 && budgetSource.size === 0) return forecastSource

  const result = new Map(forecastSource)
  const keys = new Set([...forecastSource.keys(), ...budgetSource.keys()])

  keys.forEach((key) => {
    const [description] = key.split("\t")
    if (!BUDGET_ONLY_LINES.has(normDesc(description))) return
    result.set(key, budgetSource.get(key) ?? 0)
  })

  return result
}

function getPreviousMonthPeriod(year: number, month: number) {
  if (month <= 1) {
    return { year: year - 1, month: 12 }
  }

  return { year, month: month - 1 }
}

export default function ForecastPage() {
  const searchParams = useSearchParams()
  const branchFromUrl = searchParams.get("branch")
  const monthFromUrl = Number(searchParams.get("month"))
  const descriptionFromUrl = searchParams.get("description")
  const router = useRouter()
  const [branches, setBranches] = useState<Branch[]>([])
  // Default to summary (all branches) so HQ/Region Admin see rollup immediately, not "Select a Branch"
  const [selectedBranch, setSelectedBranch] = useState<string>(branchFromUrl || ALL_BRANCHES_ID)
  // HQ only: when viewing summary, filter by region ("" = all regions, else region_id)
  const [selectedRegionId, setSelectedRegionId] = useState<string>(ALL_REGIONS_ID)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [forecasts, setForecasts] = useState<ForecastResult[]>([])
  const [rawForecastRows, setRawForecastRows] = useState<{ branch_id: string; description: string; month: number; forecast_value: number; budget_value: number }[]>([])
  const [summaryActualRows, setSummaryActualRows] = useState<{ branch_id: string; description: string; year: number; month: number; value: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [needsBranchAssignment, setNeedsBranchAssignment] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDescription, setSelectedDescription] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [showMethodology, setShowMethodology] = useState<boolean>(false)
  const [currentYear, setCurrentYear] = useState(2026)
  const [currentMonth, setCurrentMonth] = useState(() => {
    const m = Number.isInteger(monthFromUrl) && monthFromUrl >= 1 && monthFromUrl <= 12
      ? monthFromUrl
      : new Date().getMonth() + 1
    return m >= 1 && m <= 12 ? m : 1
  })
  const supabase = createClient()
  const lastFetchedKeyRef = useRef<string | null>(null)
  const [lastMonthActuals, setLastMonthActuals] = useState<Map<string, number>>(new Map())
  const [breakdownVersion, setBreakdownVersion] = useState(0)
  const [editedCells, setEditedCells] = useState<Set<string>>(new Set())
  const [monthStatuses, setMonthStatuses] = useState<Record<number, ForecastMonthStatus>>({})
  const [monthStatusActionMonth, setMonthStatusActionMonth] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [workingDays, setWorkingDays] = useState<Record<number, number>>({})
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Collapse state for the (long) Branch contribution card so users can reach the table faster.
  const [branchContributionOpen, setBranchContributionOpen] = useState(true)
  // Cache of loaded forecast data per scope so Back/forward navigation restores instantly.
  const forecastCacheRef = useRef<Map<string, CachedForecast>>(new Map())
  // The scope key currently displayed; used to decide whether to show a skeleton (loading, no cached data yet).
  const [activeScopeKey, setActiveScopeKey] = useState<string | null>(null)

  // Persist the Branch contribution card collapse state across reloads.
  useEffect(() => {
    const saved = window.localStorage.getItem("orkin:branchContributionOpen")
    if (saved !== null) setBranchContributionOpen(saved === "true")
  }, [])
  useEffect(() => {
    window.localStorage.setItem("orkin:branchContributionOpen", String(branchContributionOpen))
  }, [branchContributionOpen])

  const regionsList = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    branches.forEach((b: Branch) => {
      if (b.region_id && b.regions?.name && !m.has(b.region_id)) {
        m.set(b.region_id, { id: b.region_id, name: b.regions.name })
      }
    })
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [branches])

  // Branch ids + metadata for the current summary scope (HQ total or region-filtered).
  // Used by the Total Company hover drill-down to fetch per-branch figures.
  const summaryBranchIds = useMemo(() => {
    if (selectedBranch !== ALL_BRANCHES_ID) return []
    return selectedRegionId && selectedRegionId !== ALL_REGIONS_ID
      ? branches.filter((b) => b.region_id === selectedRegionId).map((b) => b.id)
      : branches.map((b) => b.id)
  }, [selectedBranch, selectedRegionId, branches])

  const branchMeta = useMemo(
    () => branches.map((b) => ({ id: b.id, name: b.name, code: b.code })),
    [branches]
  )

  const handleSelectBranch = useCallback(
    (branchId: string, description: string) => {
      const params = new URLSearchParams({
        branch: branchId,
        month: String(currentMonth),
        description,
      })
      router.push(`/dashboard/forecast?${params.toString()}`, { scroll: false })
    },
    [router, currentMonth]
  )

  const previousActualPeriod = useMemo(
    () => getPreviousMonthPeriod(currentYear, currentMonth),
    [currentYear, currentMonth]
  )

  const summaryBranchMetrics = useMemo(() => {
    const result = new Map<string, Map<string, SummaryBranchMetric>>()
    if (selectedBranch !== ALL_BRANCHES_ID || summaryBranchIds.length === 0) return result

    const scopedBranchIds = new Set(summaryBranchIds)
    const forecastByBranch = new Map<string, Map<string, number>>()
    const budgetByBranch = new Map<string, Map<string, number>>()
    const actualsByBranch = new Map<string, Map<string, number>>()

    const ensureMap = (container: Map<string, Map<string, number>>, branchId: string) => {
      let branchMap = container.get(branchId)
      if (!branchMap) {
        branchMap = new Map<string, number>()
        container.set(branchId, branchMap)
      }
      return branchMap
    }

    rawForecastRows.forEach((row) => {
      if (row.month !== currentMonth || !scopedBranchIds.has(row.branch_id)) return
      const key = `${row.description}\t${row.month}`
      ensureMap(forecastByBranch, row.branch_id).set(key, Number(row.forecast_value) || 0)
      ensureMap(budgetByBranch, row.branch_id).set(key, Number(row.budget_value) || 0)
    })

    summaryActualRows.forEach((row) => {
      if (
        row.year !== previousActualPeriod.year ||
        row.month !== previousActualPeriod.month ||
        !scopedBranchIds.has(row.branch_id)
      ) return
      const key = `${row.description}\t${row.month}`
      ensureMap(actualsByBranch, row.branch_id).set(key, Number(row.value) || 0)
    })

    summaryBranchIds.forEach((branchId) => {
      const budgetMap = recomputeSubtotalMetricMap(budgetByBranch.get(branchId) ?? new Map<string, number>())
      const forecastMap = recomputeSubtotalMetricMap(
        applyBudgetOnlyForecastOverrides(
          forecastByBranch.get(branchId) ?? new Map<string, number>(),
          budgetMap
        )
      )
      const actualsMap = recomputeSubtotalMetricMap(actualsByBranch.get(branchId) ?? new Map<string, number>())
      const branchMetrics = new Map<string, SummaryBranchMetric>()
      const descriptions = new Set<string>()

      ;[...forecastMap.keys(), ...budgetMap.keys(), ...actualsMap.keys()].forEach((key) => {
        const [description] = key.split("\t")
        descriptions.add(description)
      })

      descriptions.forEach((description) => {
        branchMetrics.set(description, {
          forecast: forecastMap.get(`${description}\t${currentMonth}`) ?? 0,
          budget: budgetMap.get(`${description}\t${currentMonth}`) ?? 0,
          actuals: actualsMap.get(`${description}\t${previousActualPeriod.month}`),
        })
      })

      result.set(branchId, branchMetrics)
    })

    return result
  }, [selectedBranch, summaryBranchIds, rawForecastRows, summaryActualRows, currentMonth, previousActualPeriod])

  // Per-branch breakdown for region/HQ summary view (revenue + expenses + contribution b/4 overhead for current month)
  // Derived from current-month child rows so it matches the corrected HQ table math.
  const branchBreakdown = useMemo(() => {
    if (selectedBranch !== ALL_BRANCHES_ID || summaryBranchIds.length === 0) return []

    return branches
      .filter((b) => summaryBranchIds.includes(b.id))
      .map((b) => ({
        branch: b,
        revenueForecast: summaryBranchMetrics.get(b.id)?.get("TOTAL NET REVENUE")?.forecast ?? 0,
        revenueBudget: summaryBranchMetrics.get(b.id)?.get("TOTAL NET REVENUE")?.budget ?? 0,
        expenseForecast: summaryBranchMetrics.get(b.id)?.get("TOTAL EXPENSES")?.forecast ?? 0,
        expenseBudget: summaryBranchMetrics.get(b.id)?.get("TOTAL EXPENSES")?.budget ?? 0,
        contribForecast: summaryBranchMetrics.get(b.id)?.get("CONTRIBUTION B/4 OVERHEAD")?.forecast ?? 0,
        contribBudget: summaryBranchMetrics.get(b.id)?.get("CONTRIBUTION B/4 OVERHEAD")?.budget ?? 0,
      }))
      .sort((a, b) => a.branch.name.localeCompare(b.branch.name))
  }, [selectedBranch, summaryBranchIds, branches, summaryBranchMetrics])

  const years = [2024, 2025, 2026, 2027, 2028]
  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: getShortMonthName(i + 1) }))

  // When profile loads, fetch the branches this user is allowed to access.
  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      setNeedsBranchAssignment(false)

      const { data: profileData } = await supabase
        .from("profiles")
        .select("role, branch_id, region_id")
        .eq("id", user.id)
        .single()

      if (profileData) {
        setProfile(profileData)

        // Use API for branches to avoid RLS issues and to support explicit multi-branch assignments.
        const res = await fetch("/api/branches", { cache: "no-store" })
        const { branches: branchData } = res.ok ? await res.json().catch(() => ({})) : { branches: null }
        let availableBranches = Array.isArray(branchData) ? branchData : []

        if (profileData.role === "branch_user") {
          if (availableBranches.length === 0) {
            const { data: accessRows } = await supabase
              .from("user_branch_access")
              .select("branch_id, branches(id, name, code, region_id, regions(name))")
              .eq("user_id", user.id)

            availableBranches = normalizeAssignedBranches((accessRows ?? []) as BranchAccessRow[])
          }

          setBranches(availableBranches)

          if (branchFromUrl && availableBranches.some((b: Branch) => b.id === branchFromUrl)) {
            setSelectedBranch(branchFromUrl)
          } else if (availableBranches.length > 0) {
            setSelectedBranch(availableBranches[0].id)
          } else if (profileData.branch_id) {
            setSelectedBranch(profileData.branch_id)
          } else {
            setNeedsBranchAssignment(true)
          }
          setLoading(false)
          return
        }

        // HQ and Region Admin keep summary view; branch_user already handled above
        // Skip if a specific branch was requested via URL to avoid a race condition
        // where the ALL_BRANCHES fetch overwrites the single-branch fetch result.
        if (!branchFromUrl && (profileData.role === "hq_admin" || profileData.role === "region_admin")) {
          setSelectedBranch(ALL_BRANCHES_ID)
        }

        if (availableBranches.length > 0) {
          setBranches(availableBranches)
          if (branchFromUrl && availableBranches.some((b: Branch) => b.id === branchFromUrl)) {
            setSelectedBranch(branchFromUrl)
          }
        } else if (profileData.role === "hq_admin") {
          // Fallback for HQ: direct query (RLS allows all)
          const { data } = await supabase
            .from("branches")
            .select("*, regions(name)")
            .order("name")
          if (data) {
            setBranches(data)
            if (branchFromUrl && data.some((b: Branch) => b.id === branchFromUrl)) {
              setSelectedBranch(branchFromUrl)
            }
          }
        }
      }
    }
    fetchData()
  }, [supabase, branchFromUrl])

  const showBranchSelector = branches.length > 0 && (profile?.role !== "branch_user" || branches.length > 1)
  const branchSelectorValue = profile?.role === "branch_user"
    ? (branches.some((branch) => branch.id === selectedBranch) ? selectedBranch : branches[0]?.id ?? "")
    : selectedBranch || ALL_BRANCHES_ID

  const loadMonthStatuses = useCallback(async (branchId: string, year: number) => {
    const { data: statusRows, error: statusError } = await supabase
      .from("forecast_month_status")
      .select("month, is_completed, completed_at, completed_by, unlocked_at, unlocked_by")
      .eq("branch_id", branchId)
      .eq("year", year)

    if (statusError) {
      throw statusError
    }

    const userIds = [...new Set(
      (statusRows ?? []).flatMap((row) => [row.completed_by, row.unlocked_by]).filter((value): value is string => Boolean(value))
    )]

    const { data: userNames } = userIds.length > 0
      ? await supabase.rpc("resolve_user_names", { user_ids: userIds })
      : { data: [] }

    const nameMap = new Map<string, string>(
      (userNames ?? []).map((entry: { id: string; display_name: string }) => [entry.id, entry.display_name])
    )

    const nextStatuses: Record<number, ForecastMonthStatus> = {}
    for (const row of (statusRows ?? []) as ForecastMonthStatusRow[]) {
      nextStatuses[row.month] = {
        isCompleted: row.is_completed,
        completedAt: row.completed_at,
        completedByName: row.completed_by ? (nameMap.get(row.completed_by) ?? "Unknown") : null,
        unlockedAt: row.unlocked_at,
        unlockedByName: row.unlocked_by ? (nameMap.get(row.unlocked_by) ?? "Unknown") : null,
      }
    }

    return nextStatuses
  }, [supabase])

  const setForecastMonthStatus = useCallback(async (month: number, completed: boolean, note?: string | null) => {
    if (!selectedBranch || selectedBranch === ALL_BRANCHES_ID) return

    setMonthStatusActionMonth(month)
    setError(null)

    try {
      const { error: statusError } = await supabase.rpc("set_forecast_month_status", {
        p_branch_id: selectedBranch,
        p_year: currentYear,
        p_month: month,
        p_completed: completed,
        p_note: note?.trim() ? note.trim() : null,
      })

      if (statusError) {
        throw statusError
      }

      const refreshedStatuses = await loadMonthStatuses(selectedBranch, currentYear)
      setMonthStatuses(refreshedStatuses)
      toast.success(
        completed
          ? `${getShortMonthName(month)} marked as forecasted and locked.`
          : `${getShortMonthName(month)} unlocked for rework.`
      )
    } catch (err: any) {
      console.error("Error updating forecast month status:", err)
      setError(err?.message || "Failed to update forecast verification status")
      toast.error(err?.message || "Failed to update forecast verification status")
    } finally {
      setMonthStatusActionMonth(null)
    }
  }, [selectedBranch, currentYear, supabase, loadMonthStatuses])

  const loadForecasts = useCallback(async (opts?: { silent?: boolean }) => {
    if (!selectedBranch) return

    const branchCount = selectedBranch === ALL_BRANCHES_ID ? branches.length : 0
    const scopeKey = buildScopeKey(selectedBranch, selectedRegionId, currentYear, currentMonth, branchCount)

    if (!opts?.silent) {
      setLoading(true)
      setError(null)
    }

    try {
      if (selectedBranch === ALL_BRANCHES_ID) {
        setMonthStatuses({})
        setEditedCells(new Set())
        const branchIds = selectedRegionId && selectedRegionId !== ALL_REGIONS_ID
          ? branches.filter((b: Branch) => b.region_id === selectedRegionId).map((b: Branch) => b.id)
          : branches.map((b: Branch) => b.id)
        if (branchIds.length === 0) {
          setForecasts([])
          setRawForecastRows([])
          setSummaryActualRows([])
          setLoading(false)
          return
        }

        // Use RPC for server-side aggregation (single query instead of 200+ paginated fetches)
        // PostgREST max-rows is 1000, so fetch in two page ranges.
        // Retry once on timeout — first call on cold cache can exceed statement_timeout.
        const callAgg = async () => {
          const [r1, r2] = await Promise.all([
            supabase.rpc("aggregate_forecasts", { p_branch_ids: branchIds, p_year: currentYear }).range(0, 999),
            supabase.rpc("aggregate_forecasts", { p_branch_ids: branchIds, p_year: currentYear }).range(1000, 2999),
          ])
          if (r1.error) throw r1.error
          return [...(r1.data ?? []), ...(r2.data ?? [])]
        }

        let aggRows: any[]
        try {
          aggRows = await callAgg()
        } catch (e: any) {
          if (e?.message?.includes("timeout") || e?.code === "57014") {
            // Retry once — data is now in PostgreSQL cache
            aggRows = await callAgg()
          } else {
            throw e
          }
        }

        const fetchPagedSummaryForecastRows = async () => {
          const rows: { branch_id: string; description: string; month: number; forecast_value: number; budget_value: number }[] = []
          const pageSize = 1000
          let from = 0

          while (true) {
            const { data, error } = await supabase
              .from("forecasts")
              .select("branch_id, description, month, forecast_value, budget_value")
              .in("branch_id", branchIds)
              .eq("year", currentYear)
              .eq("month", currentMonth)
              .range(from, from + pageSize - 1)

            if (error) throw error
            const chunk = data ?? []
            rows.push(...chunk)
            if (chunk.length < pageSize) break
            from += pageSize
          }

          return rows
        }

        const fetchPagedSummaryActualRows = async () => {
          const rows: { branch_id: string; description: string; year: number; month: number; value: number }[] = []
          const pageSize = 1000
          let from = 0

          while (true) {
            const { data, error } = await supabase
              .from("last_month_actuals")
              .select("branch_id, description, year, month, value")
              .in("branch_id", branchIds)
              .eq("year", previousActualPeriod.year)
              .eq("month", previousActualPeriod.month)
              .range(from, from + pageSize - 1)

            if (error) throw error
            const chunk = data ?? []
            rows.push(...chunk)
            if (chunk.length < pageSize) break
            from += pageSize
          }

          return rows
        }

        const [summaryForecastRows, nextSummaryActualRows, actualResult] = await Promise.all([
          fetchPagedSummaryForecastRows(),
          fetchPagedSummaryActualRows(),
          supabase.from("actuals").select("description,month,value").in("branch_id", branchIds).eq("year", currentYear).limit(5000)
        ])

        const actualRows = actualResult.data ?? []

        // Build forecasts from aggregated data
        const byKey = new Map<string, { forecast: number; budget: number; actual: number; lastMonth: number; lastYear: number }>()
        aggRows.forEach((f: any) => {
          const key = `${f.description}\t${f.month}`
          byKey.set(key, {
            forecast: Number(f.forecast_value),
            budget: Number(f.budget_value),
            actual: 0,
            lastMonth: Number(f.last_month_value),
            lastYear: Number(f.last_year_value),
          })
        })
        actualRows.forEach((a: any) => {
          const key = `${a.description}\t${a.month}`
          const cur = byKey.get(key)
          const val = Number(a.value)
          if (cur) {
            cur.actual += val
          } else {
            byKey.set(key, { forecast: 0, budget: 0, actual: val, lastMonth: 0, lastYear: 0 })
          }
        })

        const forecasts: ForecastResult[] = Array.from(byKey.entries()).map(([key, v]) => {
          const [description, monthStr] = key.split("\t")
          const month = Number(monthStr)
          const variance = v.forecast - v.budget
          const variancePercent = v.budget !== 0 ? (variance / v.budget) * 100 : 0
          return { description, month, forecastValue: v.forecast, budgetValue: v.budget, actualValue: v.actual, lastMonthValue: v.lastMonth, lastYearValue: v.lastYear, variance, variancePercent }
        })
        forecasts.sort((a, b) => (a.description.localeCompare(b.description) || a.month - b.month))

        setForecasts(forecasts)
        setRawForecastRows(summaryForecastRows)
        setSummaryActualRows(nextSummaryActualRows)
        forecastCacheRef.current.set(scopeKey, { forecasts, rawForecastRows: summaryForecastRows, summaryActualRows: nextSummaryActualRows, monthStatuses: {}, editedCells: new Set() })
      } else {
        // Single branch view — ~2000 rows, but PostgREST max-rows is 1000, so fetch in 2 pages
        const [forecastRes1, forecastRes2, actualRes, auditRes, statusMap] = await Promise.all([
          supabase.from("forecasts").select("*").eq("branch_id", selectedBranch).eq("year", currentYear).order("id").range(0, 999),
          supabase.from("forecasts").select("*").eq("branch_id", selectedBranch).eq("year", currentYear).order("id").range(1000, 1999),
          supabase.from("actuals").select("*").eq("branch_id", selectedBranch).eq("year", currentYear),
          supabase.from("forecast_audit_log").select("description, month").eq("branch_id", selectedBranch).eq("year", currentYear).limit(5000),
          loadMonthStatuses(selectedBranch, currentYear)
        ])

        setMonthStatuses(statusMap)

        // Build set of edited cells from audit log
        const editedKeys = new Set<string>()
        for (const entry of auditRes.data ?? []) {
          editedKeys.add(`${entry.description}\t${entry.month}`)
        }
        setEditedCells(editedKeys)

        if (forecastRes1.error) throw forecastRes1.error
        const existingForecasts = [...(forecastRes1.data ?? []), ...(forecastRes2.data ?? [])]
        const existingActuals = actualRes.data ?? []

        const actualMap = new Map<string, number>()
        existingActuals.forEach(a => {
          actualMap.set(`${a.description}\t${a.month}`, Number(a.value))
        })

        if (existingForecasts.length > 0 || existingActuals.length > 0) {
          const formattedForecasts: ForecastResult[] = existingForecasts.map(f => ({
            description: f.description,
            month: f.month,
            forecastValue: f.forecast_value,
            budgetValue: f.budget_value,
            actualValue: actualMap.get(`${f.description}\t${f.month}`) || 0,
            lastMonthValue: f.last_month_value,
            lastYearValue: f.last_year_value,
            variance: f.forecast_value - f.budget_value,
            variancePercent: f.budget_value !== 0 ? ((f.forecast_value - f.budget_value) / f.budget_value) * 100 : 0,
          }))

          // Fill missing TEMPLATE_ORDER descriptions with zero rows for all 12 months
          // Skip section headers (category labels that never have financial data)
          const SECTION_HEADERS = new Set([
            "PEST CONTROL REVENUE", "ALLOWANCES", "MISCELLANEOUS REVENUE",
            "TERMITE (TC) REVENUE", "PAYROLL", "PERSONNEL RELATED",
            "MATERIALS AND SUPPLIES", "VEHICLE EXPENSES", "VEHICLE STANDING EXPENSES",
            "INSURANCE & CLAIMS", "BAD DEBTS", "OTHER EXPENSES", "FIXED EXPENSES",
            "CONTROLLABLE EXPENSES", "TELEPHONE & UTILITIES", "OVERHEAD ALLOCATIONS",
          ].map(normForMatch))
          const existingKeys = new Set(formattedForecasts.map(f => `${normForMatch(f.description)}\t${f.month}`))
          for (const desc of TEMPLATE_ORDER) {
            if (SECTION_HEADERS.has(normForMatch(desc))) continue
            for (let m = 1; m <= 12; m++) {
              if (!existingKeys.has(`${normForMatch(desc)}\t${m}`)) {
                formattedForecasts.push({
                  description: desc,
                  month: m,
                  forecastValue: 0,
                  budgetValue: 0,
                  actualValue: 0,
                  lastMonthValue: 0,
                  lastYearValue: 0,
                  variance: 0,
                  variancePercent: 0,
                })
              }
            }
          }

          setForecasts(formattedForecasts)
          forecastCacheRef.current.set(scopeKey, { forecasts: formattedForecasts, rawForecastRows: existingForecasts, summaryActualRows: [], monthStatuses: statusMap, editedCells: editedKeys })
        } else {
          // No data at all — generate full zero template (skip section headers)
          const SECTION_HEADERS_EMPTY = new Set([
            "PEST CONTROL REVENUE", "ALLOWANCES", "MISCELLANEOUS REVENUE",
            "TERMITE (TC) REVENUE", "PAYROLL", "PERSONNEL RELATED",
            "MATERIALS AND SUPPLIES", "VEHICLE EXPENSES", "VEHICLE STANDING EXPENSES",
            "INSURANCE & CLAIMS", "BAD DEBTS", "OTHER EXPENSES", "FIXED EXPENSES",
            "CONTROLLABLE EXPENSES", "TELEPHONE & UTILITIES", "OVERHEAD ALLOCATIONS",
          ].map(normForMatch))
          const zeroForecasts: ForecastResult[] = []
          for (const desc of TEMPLATE_ORDER) {
            if (SECTION_HEADERS_EMPTY.has(normForMatch(desc))) continue
            for (let m = 1; m <= 12; m++) {
              zeroForecasts.push({
                description: desc,
                month: m,
                forecastValue: 0,
                budgetValue: 0,
                actualValue: 0,
                lastMonthValue: 0,
                lastYearValue: 0,
                variance: 0,
                variancePercent: 0,
              })
            }
          }
          setForecasts(zeroForecasts)
          forecastCacheRef.current.set(scopeKey, { forecasts: zeroForecasts, rawForecastRows: [], summaryActualRows: [], monthStatuses: statusMap, editedCells: editedKeys })
        }
        setRawForecastRows(existingForecasts)
        setSummaryActualRows([])
      }
    } catch (err: any) {
      console.error("Error loading forecasts:", err?.message || err?.code || JSON.stringify(err) || err)
      // Don't surface errors from a silent background revalidation over good cached data.
      if (!opts?.silent) setError(err?.message || "Failed to load forecasts")
    } finally {
      setLoading(false)
    }
  }, [selectedBranch, selectedRegionId, supabase, currentYear, currentMonth, branches, loadMonthStatuses, previousActualPeriod])

  const fetchVersionRef = useRef(0)

  // Keep selectedBranch in sync with the URL immediately so Back/forward navigation feels
  // instant, instead of waiting for the heavier fetchData effect to re-fetch profile/branches.
  useEffect(() => {
    if (branchFromUrl) {
      setSelectedBranch(branchFromUrl)
    } else if (profile?.role === "hq_admin" || profile?.role === "region_admin") {
      setSelectedBranch(ALL_BRANCHES_ID)
    }
  }, [branchFromUrl, profile])

  useEffect(() => {
    if (Number.isInteger(monthFromUrl) && monthFromUrl >= 1 && monthFromUrl <= 12) {
      setCurrentMonth(monthFromUrl)
    }
  }, [monthFromUrl])

  useEffect(() => {
    if (descriptionFromUrl) {
      setSelectedDescription("all")
      setSearchQuery("")
    }
  }, [descriptionFromUrl])

  useEffect(() => {
    if (!selectedBranch) return
    const branchCount = selectedBranch === ALL_BRANCHES_ID ? branches.length : 0
    const key = buildScopeKey(selectedBranch, selectedRegionId, currentYear, currentMonth, branchCount)
    const cached = forecastCacheRef.current.get(key)
    if (cached) {
      // Restore instantly for snappy Back/forward navigation; revalidate silently in the background.
      setForecasts(cached.forecasts)
      setRawForecastRows(cached.rawForecastRows)
      setSummaryActualRows(cached.summaryActualRows)
      setMonthStatuses(cached.monthStatuses)
      setEditedCells(cached.editedCells)
      setLoading(false)
      setError(null)
      setActiveScopeKey(key)
      lastFetchedKeyRef.current = key
      const version = ++fetchVersionRef.current
      loadForecasts({ silent: true }).then(() => {
        if (fetchVersionRef.current !== version) lastFetchedKeyRef.current = null
      })
      return
    }
    if (lastFetchedKeyRef.current === key) return
    lastFetchedKeyRef.current = key
    // Increment version so stale in-flight fetches are discarded
    const version = ++fetchVersionRef.current
    loadForecasts().then(() => {
      // If another fetch was triggered while this one was in flight, discard these results
      if (fetchVersionRef.current !== version) {
        // A newer fetch is in progress; re-trigger with current selectedBranch
        lastFetchedKeyRef.current = null
      } else {
        setActiveScopeKey(key)
      }
    })
  }, [selectedBranch, selectedRegionId, currentYear, currentMonth, branches.length, loadForecasts])

  // ── Fetch last month actuals from the last_month_actuals table ──
  const fetchLastMonthActuals = useCallback(async () => {
    if (!selectedBranch || !profile) return

    try {
      // PostgREST silently caps responses at 1000 rows even with .range(0, 299999),
      // so a single query only returns the first 1000 rows. Paginate in chunks of 1000.
      const PAGE_SIZE = 1000
      const allRows: { description: string; month: number; value: number }[] = []
      let pageFrom = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let pageQuery = supabase
          .from("last_month_actuals")
          .select("description, month, value")
          .eq("year", currentYear)
          .range(pageFrom, pageFrom + PAGE_SIZE - 1)

        if (selectedBranch === ALL_BRANCHES_ID) {
          if (profile.role === "hq_admin") {
            if (selectedRegionId && selectedRegionId !== ALL_REGIONS_ID) {
              pageQuery = pageQuery.eq("region_id", selectedRegionId)
            } else {
              pageQuery = pageQuery.eq("is_company_wide", true)
            }
          } else if (profile.role === "region_admin" && profile.region_id) {
            pageQuery = pageQuery.eq("region_id", profile.region_id)
          }
        } else {
          pageQuery = pageQuery.eq("branch_id", selectedBranch)
        }

        const { data: page, error: fetchErr } = await pageQuery
        if (fetchErr) {
          if (fetchErr.code !== "PGRST204" && fetchErr.code !== "PGRST205") {
            console.error("Error fetching last month actuals:", fetchErr)
          }
          return
        }
        if (!page || page.length === 0) break
        allRows.push(...page)
        if (page.length < PAGE_SIZE) break
        pageFrom += PAGE_SIZE
      }

      const map = new Map<string, number>()
      for (const row of allRows) {
        map.set(`${row.description}\t${row.month}`, Number(row.value))
      }
      setLastMonthActuals(map)
      setBreakdownVersion((current) => current + 1)
    } catch (err) {
      console.error("Error fetching last month actuals:", err)
    }
  }, [selectedBranch, selectedRegionId, profile, currentYear, supabase])

  const completedMonths = useMemo(
    () => new Set(
      Object.entries(monthStatuses)
        .filter(([, status]) => status.isCompleted)
        .map(([month]) => Number(month))
    ),
    [monthStatuses]
  )

  // Region-scope check: a region_admin can lock and unlock forecast
  // months for branches in their own region (mirrors the SQL gate in
  // set_forecast_month_status — UI is a UX hint, the SQL is the
  // security boundary). Requires scripts/021_region_admin_lock_unlock.sql.
  const selectedBranchRegionId = useMemo(() => {
    if (!selectedBranch || selectedBranch === ALL_BRANCHES_ID) return null
    return branches.find((b) => b.id === selectedBranch)?.region_id ?? null
  }, [selectedBranch, branches])

  const isRegionScopeBranch =
    profile?.role === "region_admin" &&
    selectedBranch !== ALL_BRANCHES_ID &&
    selectedBranchRegionId != null &&
    selectedBranchRegionId === profile.region_id

  const canCompleteForecastMonth =
    (profile?.role === "branch_user" && selectedBranch !== ALL_BRANCHES_ID) ||
    isRegionScopeBranch
  const canUnlockForecastMonth =
    (profile?.role === "hq_admin" || isRegionScopeBranch) &&
    selectedBranch !== ALL_BRANCHES_ID

  const fetchWorkingDays = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("working_days")
        .select("month, days")
        .eq("year", currentYear)

      if (error) {
        if (error.code !== "PGRST204" && error.code !== "PGRST205") {
          console.error("Error fetching working days:", error)
        }
        return
      }

      const map: Record<number, number> = {}
      for (const row of data ?? []) {
        map[row.month] = row.days
      }
      setWorkingDays(map)
    } catch (err) {
      console.error("Error fetching working days:", err)
    }
  }, [currentYear, supabase])

  const handleUpdateWorkingDays = useCallback(async (month: number, days: number) => {
    try {
      const { error } = await supabase
        .from("working_days")
        .upsert({
          year: currentYear,
          month: month,
          days: days,
          updated_at: new Date().toISOString()
        }, {
          onConflict: "year,month"
        })

      if (error) {
        throw error
      }

      toast.success(`Updated working days for ${getShortMonthName(month)} to ${days} W/D.`)
      await fetchWorkingDays()
    } catch (err: any) {
      console.error("Error updating working days:", err)
      toast.error(err.message || "Failed to update working days")
    }
  }, [currentYear, supabase, fetchWorkingDays])

  useEffect(() => {
    fetchLastMonthActuals()
  }, [fetchLastMonthActuals])

  useEffect(() => {
    fetchWorkingDays()
  }, [fetchWorkingDays])

  // ── File selection handler ──
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setSelectedFile(file)
  }

  // ── Upload actuals handler (client-side Excel parsing) ──
  const handleUploadActuals = async () => {
    const file = selectedFile
    if (!file) return

    setUploading(true)
    try {
      // 1. Parse Excel in the browser
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" })

      // Constants matching the Excel P&L layout
      const DESC_COL_T = 19, MONTH_START = 20, MONTH_END = 31, HDR_ROW = 8
      const SKIP_DESCS = new Set(["line of bus", "district", "gl", "period", "orkin canada", "spare row", "spare", "actual", "*", ""])
      const SKIP_PREFIXES = ["toc", "travel", "mktg dept"]
      const SKIP_EXACT = new Set(["ntl accts (total)", "ttl qa", "inputs"])
      const SKIP_TTL = new Set(["ttl pac_gvr", "ttl island", "ttl barrie", "ttl edm", "ttl sask & reg", "ttl gta res", "ttl nfld"])

      const toNum = (v: unknown): number | null => {
        if (v === undefined || v === null || v === "") return null
        if (typeof v === "number" && !Number.isNaN(v)) return v
        const n = parseFloat(String(v).replace(/,/g, ""))
        return Number.isNaN(n) ? null : n
      }

      const shouldSkip = (t: string) => {
        if (SKIP_EXACT.has(t) || SKIP_TTL.has(t)) return true
        if (SKIP_PREFIXES.some(p => t.startsWith(p))) return true
        if (/^ttl\s/i.test(t)) return true
        return false
      }

      // 2. Build master description map from ORKIN CANADA column T (single source of truth)
      const masterDescByRow = new Map<number, string>()
      const canadaSheet = workbook.Sheets["ORKIN CANADA"]
      if (!canadaSheet) {
        toast.error("Excel file is missing the ORKIN CANADA sheet")
        return
      }
      const canadaRows = XLSX.utils.sheet_to_json(canadaSheet, { header: 1, defval: "" }) as unknown[][]
      for (let i = HDR_ROW + 1; i < canadaRows.length; i++) {
        const desc = String(canadaRows[i]?.[DESC_COL_T] ?? "").trim()
        if (desc && !SKIP_DESCS.has(desc.toLowerCase()) && !/^\d+$/.test(desc)) {
          masterDescByRow.set(i, desc)
        }
      }

      // 3. Detect year and last month with data
      let detectedYear: number | null = null
      let lastMonth = 0

      for (let r = 0; r < Math.min(canadaRows.length, 10); r++) {
        for (let c = 0; c < (canadaRows[r]?.length || 0); c++) {
          const m = String(canadaRows[r][c] || "").match(/\b(202[0-9])\b/)
          if (m) { detectedYear = parseInt(m[1], 10); break }
        }
        if (detectedYear) break
      }

      for (let i = HDR_ROW + 1; i < canadaRows.length; i++) {
        if (!masterDescByRow.has(i)) continue
        for (let m = MONTH_END; m >= MONTH_START; m--) {
          const val = toNum(canadaRows[i][m])
          if (val !== null && val !== 0) {
            const mo = m - MONTH_START + 1
            if (mo > lastMonth) lastMonth = mo
            break
          }
        }
      }

      if (!detectedYear || lastMonth === 0) {
        toast.error("Could not detect year or month from the Excel file")
        return
      }

      const months = Array.from({ length: lastMonth }, (_, i) => i + 1)

      // 4. Extract data from each relevant sheet using master descriptions
      const sheets: Array<{ tabName: string; rows: Array<{ description: string; month: number; value: number }> }> = []

      for (const name of workbook.SheetNames) {
        const low = name.trim().toLowerCase()
        if (shouldSkip(low)) continue

        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "" }) as unknown[][]
        const extracted: Array<{ description: string; month: number; value: number }> = []

        for (const [rowIdx, desc] of masterDescByRow) {
          const row = rows[rowIdx] || []
          for (const mo of months) {
            const colIdx = MONTH_START + mo - 1
            extracted.push({ description: desc, month: mo, value: toNum(row[colIdx]) ?? 0 })
          }
        }

        if (extracted.length > 0) {
          sheets.push({ tabName: name, rows: extracted })
        }
      }

      // 5. Send parsed data to API in batches to stay under Vercel's 4.5 MB payload limit.
      //    With ~108 sheets × 203 descriptions the full JSON can easily exceed 5 MB,
      //    so we chunk sheets into groups of 20 and POST them sequentially.
      const SHEETS_PER_BATCH = 20
      const totalBatches = Math.max(1, Math.ceil(sheets.length / SHEETS_PER_BATCH))

      let totalBranchesMatched = 0
      let totalRegionsMatched = 0
      let finalResult: Record<string, unknown> | null = null

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchSheets = sheets.slice(batchIndex * SHEETS_PER_BATCH, (batchIndex + 1) * SHEETS_PER_BATCH)
        const isFinalBatch = batchIndex === totalBatches - 1

        const res = await fetch("/api/upload-actuals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year: detectedYear, months, sheets: batchSheets, batchIndex, isFinalBatch }),
        })

        const result = await res.json()

        if (!res.ok) {
          toast.error(result.error || `Upload failed on batch ${batchIndex + 1}`)
          return
        }

        totalBranchesMatched += result.branchesMatched ?? 0
        totalRegionsMatched += result.regionsMatched ?? 0

        if (isFinalBatch) {
          finalResult = { ...result, branchesMatched: totalBranchesMatched, regionsMatched: totalRegionsMatched }
        }
      }

      const result = finalResult!

      toast.success(
        `Actuals uploaded — ${result.branchesMatched} branches, ${result.regionsMatched} regions, ${result.monthRange} ${result.year}`
      )

      setSelectedFile(null)

      // Refresh the actuals data
      await fetchLastMonthActuals()

      // ── Post-upload validation ─────────────────────────────────────────
      // The chunked upload can silently drop a batch and still return 200 OK,
      // leaving the database only partially populated. Verify the company-wide
      // row count for the latest month uploaded is at least half of the
      // master TEMPLATE_ORDER length. If it's short, raise a blocking red
      // toast so the user knows to re-upload instead of seeing a silent
      // half-broken table. (Issue: June 2026 client reported rows 16+
      // showing dashes; DB had only 9 of 181 company-wide rows.)
      try {
        const { count: companyWideCount } = await supabase
          .from("last_month_actuals")
          .select("*", { count: "exact", head: true })
          .eq("year", detectedYear)
          .eq("month", lastMonth)
          .eq("is_company_wide", true)

        const minExpected = Math.floor(TEMPLATE_ORDER.length * 0.5)
        if (companyWideCount !== null && companyWideCount < minExpected) {
          toast.error(
            `Upload looks incomplete — saved ${companyWideCount} of ~${TEMPLATE_ORDER.length} line items for ${getShortMonthName(lastMonth)} ${detectedYear}. Check your network and re-upload.`,
            { duration: Infinity }
          )
        }
      } catch (validationErr) {
        // Validation is best-effort; never let it block the success path.
        console.warn("Post-upload validation failed:", validationErr)
      }
    } catch (err) {
      console.error("Upload error:", err)
      toast.error("Failed to process actuals file")
    } finally {
      setUploading(false)
    }
  }

  // ──────────────────────────────────────────────────────────────
  // P&L recalculation constants
  // Derived rows that are auto-computed from leaf items
  // ──────────────────────────────────────────────────────────────
  const DERIVED_ROW_CONTRIBUTION = "CONTRIBUTION B/4 OVERHEAD"
  const DERIVED_ROW_OPERATING_PROFIT = "OPERATING PROFIT"
  const DERIVED_ROW_BONUS_OPERATING_PROFIT = "BONUS OPERATING PROFIT"
  const DERIVED_ROW_EXTERNAL_PROFIT = "EXTERNAL PROFIT"
  const DERIVED_ROW_NET_PROFIT = "NET PROFIT"
  const TOTAL_NET_REVENUE = "TOTAL NET REVENUE"
  const TOTAL_EXPENSES = "TOTAL EXPENSES"
  const TOTAL_OVERHEAD_ALLOCATIONS = "TOTAL OVERHEAD ALLOCATIONS"
  const OVERHEAD_ALLOCATION_REVERSAL = "OVERHEAD ALLOCATION REVERSAL"
  const HOME_OFFICE_OVERHEAD = "HOME OFFICE OVERHEAD"
  const ACQUISITION_COST = "ACQUISITION COST"
  const ULTIPRO_FEES = "ULTIPRO COST"
  const FOREIGN_EXCHANGE = "FOREIGN EXCHANGE GAIN/LOSS"
  const ROYALTY_FEES = "ROYALTY FEES"
  const INTEREST_EXPENSE = "INTEREST EXPENSE ORKIN"
  const CANADIAN_TAXES = "CANADIAN TAXES"
  const NON_OP_INT = "NON-OP INT EXP/(REV)"

  // ── DEPRECATED: recalcDerivedRows ──────────────────────────────────────────
  // Previously used after edits to recalculate only 8 top-level P&L rows.
  // Replaced by recomputeAllSubtotals() which handles all 43 subtotal rules
  // (intermediate subtotals like SUBTOTAL MONTHLY, GROSS CONTRACT REVENUE, etc.)
  // Kept commented for reference.
  //
  // function recalcDerivedRows(allForecasts: ForecastResult[], targetMonth: number): Map<string, number> {
  //   const leafRows = allForecasts.filter(f => f.month === targetMonth && isLeafDescription(f.description))
  //   let totalRevenue = 0, totalExpenses = 0, totalOverhead = 0
  //   leafRows.forEach(r => {
  //     const d = normDesc(r.description)
  //     if (isRevenueLine(d)) totalRevenue += r.forecastValue
  //     else if (d.includes("ALLOCATIONS")) totalOverhead += r.forecastValue
  //     else totalExpenses += r.forecastValue
  //   })
  //   const get = (desc: string) => {
  //     const row = allForecasts.find(f => normDesc(f.description) === normDesc(desc) && f.month === targetMonth)
  //     return row ? row.forecastValue : 0
  //   }
  //   const contribution = totalRevenue - totalExpenses
  //   const operatingProfit = contribution - totalOverhead
  //   const bonusOperatingProfit = operatingProfit - get(OVERHEAD_ALLOCATION_REVERSAL)
  //   const externalProfit = bonusOperatingProfit - get(HOME_OFFICE_OVERHEAD) - get(ACQUISITION_COST) - get(ULTIPRO_FEES)
  //   const netProfit = externalProfit - get(FOREIGN_EXCHANGE) - get(ROYALTY_FEES) - get(INTEREST_EXPENSE) - get(CANADIAN_TAXES) - get(NON_OP_INT)
  //   const derivedMap = new Map<string, number>()
  //   derivedMap.set(normDesc(TOTAL_NET_REVENUE), Math.round(totalRevenue * 100) / 100)
  //   derivedMap.set(normDesc(TOTAL_EXPENSES), Math.round(totalExpenses * 100) / 100)
  //   derivedMap.set(normDesc(TOTAL_OVERHEAD_ALLOCATIONS), Math.round(totalOverhead * 100) / 100)
  //   derivedMap.set(normDesc(DERIVED_ROW_CONTRIBUTION), Math.round(contribution * 100) / 100)
  //   derivedMap.set(normDesc(DERIVED_ROW_OPERATING_PROFIT), Math.round(operatingProfit * 100) / 100)
  //   derivedMap.set(normDesc(DERIVED_ROW_BONUS_OPERATING_PROFIT), Math.round(bonusOperatingProfit * 100) / 100)
  //   derivedMap.set(normDesc(DERIVED_ROW_EXTERNAL_PROFIT), Math.round(externalProfit * 100) / 100)
  //   derivedMap.set(normDesc(DERIVED_ROW_NET_PROFIT), Math.round(netProfit * 100) / 100)
  //   return derivedMap
  // }

  const handleUpdateForecast = async (description: string, month: number, newValue: number) => {
    if (!selectedBranch || selectedBranch === ALL_BRANCHES_ID) return

    if (completedMonths.has(month)) {
      const message = `${getShortMonthName(month)} has been marked forecasted and is locked until HQ or your region admin unlocks it for rework.`
      setError(message)
      toast.error(message)
      return
    }

    // Find the old value for audit logging
    const oldRow = forecasts.find(f => f.description === description && f.month === month)
    const oldValue = oldRow?.forecastValue ?? 0

    // Log the edit to the audit trail (non-blocking – table may not exist yet)
    if (userId && oldValue !== newValue) {
      setEditedCells(prev => new Set(prev).add(`${description}\t${month}`))
      supabase
        .from("forecast_audit_log")
        .insert({
          user_id: userId,
          branch_id: selectedBranch,
          description,
          year: currentYear,
          month,
          old_value: oldValue,
          new_value: newValue,
        })
        .then(({ error: auditErr }) => {
          if (auditErr && auditErr.code !== "PGRST205") {
            console.error("Error logging forecast edit:", auditErr)
          }
        })
    }

    // 1. Save the edited row to the database.
    //    Use `upsert` (not `update`) so a missing row gets created. The
    //    natural unique index on (branch_id, description, year, month) is
    //    the conflict target. Without this, edits to descriptions that the
    //    rebuild script never seeded (e.g. on new branches with sparse
    //    data) were logged to `forecast_audit_log` but never persisted to
    //    the `forecasts` table — see incident 2026-07 where 514 cells were
    //    in the log but missing from the DB.
    const { error: updateError } = await supabase
      .from("forecasts")
      .upsert(
        {
          branch_id: selectedBranch,
          description: description,
          year: currentYear,
          month: month,
          forecast_value: newValue,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "branch_id,description,year,month", ignoreDuplicates: false }
      )

    if (updateError) {
      console.error("Error updating forecast:", updateError)
      setError("Failed to update forecast")
      toast.error("Failed to save forecast update")
      return
    }

    toast.success(`${description} updated for ${getShortMonthName(month)}`)

    // 2. Build a working copy with the new value applied
    const updatedForecasts = forecasts.map(f => {
      if (f.description === description && f.month === month) {
        return { ...f, forecastValue: newValue }
      }
      return f
    })

    // 3. Recompute ALL subtotals (intermediate + top-level) using the full hierarchy rules
    const finalForecasts = recomputeAllSubtotals(updatedForecasts)

    // 4. Diff against old state to find which subtotal rows changed for DB persistence
    const dbUpdates: { description: string; value: number }[] = []
    const oldByKey = new Map<string, number>()
    forecasts.forEach(f => {
      if (f.month === month) oldByKey.set(normDesc(f.description), f.forecastValue)
    })
    finalForecasts.forEach(f => {
      if (f.month !== month) return
      const nd = normDesc(f.description)
      const oldVal = oldByKey.get(nd)
      // Persist any row whose forecast value changed (subtotals + the edited leaf)
      if (oldVal !== undefined && Math.abs(f.forecastValue - oldVal) > 0.001 && nd !== normDesc(description)) {
        dbUpdates.push({ description: f.description, value: f.forecastValue })
      }
    })

    setForecasts(finalForecasts)

    // 5. Persist subtotal updates to database (fire-and-forget).
    //    Same upsert rationale as the leaf save above — a subtotal row may
    //    not exist yet for the (branch, description, year, month) and we
    //    need it created.
    if (dbUpdates.length > 0) {
      const now = new Date().toISOString()
      Promise.all(
        dbUpdates.map(u =>
          supabase
            .from("forecasts")
            .upsert(
              {
                branch_id: selectedBranch,
                description: u.description,
                year: currentYear,
                month: month,
                forecast_value: u.value,
                updated_at: now,
              },
              { onConflict: "branch_id,description,year,month", ignoreDuplicates: false }
            )
        )
      ).catch(err => console.error("Error saving subtotal rows:", err))
    }
  }

  // ── Recompute subtotals for display so HQ and branch views use the same math ──
  const processedForecasts = useMemo(() => recomputeAllSubtotals(forecasts), [forecasts])
  const processedLastMonthActuals = useMemo(() => recomputeSubtotalMetricMap(lastMonthActuals), [lastMonthActuals])

  const descriptions = [...new Set(processedForecasts.map(f => f.description))]
  const filteredByCategory =
    selectedDescription === "all"
      ? processedForecasts
      : processedForecasts.filter((f) => f.description === selectedDescription)
  const searchLower = searchQuery.trim().toLowerCase()
  const filteredForecasts =
    searchLower === ""
      ? filteredByCategory
      : filteredByCategory.filter((f) =>
        f.description.toLowerCase().includes(searchLower)
      )

  // Chart: when "All Categories" show KPI-only totals (same as summary cards); otherwise show selected category
  const chartForecasts =
    selectedDescription === "all"
      ? processedForecasts.filter((f) => {
        const d = normDesc(f.description)
        return d === KPI_REVENUE || KPI_EXPENSE_LINES.has(d)
      })
      : filteredForecasts

  // Summary stats: read directly from subtotal rows so cards match the table exactly
  const monthRows = processedForecasts.filter(f => f.month === currentMonth)
  const findMonthRow = (desc: string) => monthRows.find(f => normDesc(f.description) === normDesc(desc))

  const revenueRow = findMonthRow("TOTAL NET REVENUE")
  const expenseRow = findMonthRow("TOTAL EXPENSES")
  const contributionRow = findMonthRow("CONTRIBUTION B/4 OVERHEAD")

  const revenueForecast = revenueRow?.forecastValue ?? 0
  const revenueBudget = revenueRow?.budgetValue ?? 0
  const expenseForecast = expenseRow?.forecastValue ?? 0
  const expenseBudget = expenseRow?.budgetValue ?? 0
  const contributionForecast = contributionRow?.forecastValue ?? 0
  const contributionBudget = contributionRow?.budgetValue ?? 0

  const revenueVariance = revenueForecast - revenueBudget
  const revenueVariancePct = revenueBudget !== 0 ? (revenueVariance / revenueBudget) * 100 : 0
  const expenseVariance = expenseForecast - expenseBudget
  const expenseVariancePct = expenseBudget !== 0 ? (expenseVariance / expenseBudget) * 100 : 0
  const contributionVariance = contributionForecast - contributionBudget
  const contributionPct = contributionBudget !== 0 ? (contributionVariance / Math.abs(contributionBudget)) * 100 : 0

  // Full-year totals (all 12 months)
  const monthsPresent = new Set(processedForecasts.map((f) => f.month))
  const hasFullYearData = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].every((m) => monthsPresent.has(m))

  const findAnnualTotal = (desc: string) => {
    const rows = processedForecasts.filter(f => normDesc(f.description) === normDesc(desc))
    return {
      forecast: rows.reduce((sum, f) => sum + f.forecastValue, 0),
      budget: rows.reduce((sum, f) => sum + f.budgetValue, 0),
    }
  }

  const annualRevenue = findAnnualTotal("TOTAL NET REVENUE")
  const annualExpense = findAnnualTotal("TOTAL EXPENSES")
  const annualContribution = findAnnualTotal("CONTRIBUTION B/4 OVERHEAD")

  const annualRevenueForecast = annualRevenue.forecast
  const annualRevenueBudget = annualRevenue.budget
  const annualExpenseForecast = annualExpense.forecast
  const annualExpenseBudget = annualExpense.budget
  const annualContributionForecast = annualContribution.forecast
  const annualContributionBudget = annualContribution.budget
  const annualContributionVariance = annualContributionForecast - annualContributionBudget

  const exportToCSV = () => {
    const months = Array.from({ length: 12 }, (_, i) => i + 1)
    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    // Build header rows matching the table layout
    const headerRow1 = ["Description"]
    for (const m of months) {
      headerRow1.push(monthNames[m], "", "", "")
    }
    headerRow1.push("Annual Total", "")

    const headerRow2 = [""]
    for (let i = 0; i < 12; i++) {
      headerRow2.push("Forecast", "Budget", "Last Year", "Actuals")
    }
    headerRow2.push("Forecast", "Budget")

    // Get descriptions in template order and filter hidden items (same as table)
    const uniqueDescs = [...new Set(filteredForecasts.map(f => f.description))]
      .filter(d => !HIDDEN_BELOW_EXTERNAL.has(normDesc(d)))
    const sortedDescs = [...uniqueDescs].sort((a, b) => {
      const na = normForMatch(a)
      const nb = normForMatch(b)
      const findIdx = (n: string) => {
        const exact = TEMPLATE_ORDER.findIndex((t) => normForMatch(t) === n)
        if (exact !== -1) return exact
        return TEMPLATE_ORDER.findIndex((t) => {
          const nt = normForMatch(t)
          return n.startsWith(nt + " ") || nt.startsWith(n + " ")
        })
      }
      const ia = findIdx(na)
      const ib = findIdx(nb)
      if (ia >= 0 && ib >= 0) return ia - ib
      if (ia >= 0) return -1
      if (ib >= 0) return 1
      return a.localeCompare(b)
    })

    // Build data rows
    const dataRows = sortedDescs.map(desc => {
      const descForecasts = filteredForecasts.filter(f => f.description === desc)
      const row: string[] = [desc]
      let annualForecast = 0
      let annualBudget = 0

      for (const m of months) {
        const f = descForecasts.find(x => x.month === m)
        const forecastVal = f ? f.forecastValue : 0
        const budgetVal = f ? f.budgetValue : 0
        const lastYearVal = f ? f.lastYearValue : 0
        const key = `${desc}\t${m}`
        const actualsVal = processedLastMonthActuals.get(key)

        row.push(
          forecastVal.toFixed(2),
          budgetVal.toFixed(2),
          lastYearVal.toFixed(2),
          actualsVal !== undefined ? actualsVal.toFixed(2) : ""
        )
        annualForecast += forecastVal
        annualBudget += budgetVal
      }
      row.push(annualForecast.toFixed(2), annualBudget.toFixed(2))
      return row
    })

    // Escape fields containing commas or quotes
    const escapeField = (field: string) => {
      if (field.includes(",") || field.includes('"') || field.includes("\n")) {
        return `"${field.replace(/"/g, '""')}"`
      }
      return field
    }

    // Build filename with branch name
    let fileLabel = "all"
    if (selectedBranch !== ALL_BRANCHES_ID) {
      const branch = branches.find((b: Branch) => b.id === selectedBranch)
      fileLabel = branch ? branch.name.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_") : selectedBranch
    } else if (selectedRegionId && selectedRegionId !== ALL_REGIONS_ID) {
      const region = regionsList.find((r) => r.id === selectedRegionId)
      fileLabel = region ? "region_" + region.name.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_") : "region"
    }

    const csv = [headerRow1, headerRow2, ...dataRows]
      .map(row => row.map(escapeField).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `forecast_${currentYear}_${fileLabel}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadMethodologyPdf = () => {
    if (typeof window === "undefined") return
    window.print()
  }

  const viewLevelLabel =
    selectedBranch === ALL_BRANCHES_ID
      ? profile?.role === "region_admin"
        ? "Region level"
        : selectedRegionId && selectedRegionId !== ALL_REGIONS_ID
          ? "Region: " + (regionsList.find((r) => r.id === selectedRegionId)?.name ?? "Region")
          : "HQ level"
      : (() => {
        const b = branches.find((x: Branch) => x.id === selectedBranch)
        return b ? `Branch: ${b.name}` : "Branch level"
      })()

  if (loading && !profile) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (needsBranchAssignment) {
    return (
      <div className="space-y-6 min-w-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Budget vs Forecast</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            View and generate forecasts for your branch.
          </p>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Your branch has not been assigned yet. You need a branch assignment to view and generate forecasts.
            Please contact your administrator to assign your branch, or if you signed up recently, ensure you selected
            your region and branch during registration.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Budget vs Forecast</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            View budget and forecast at HQ, region, or branch for {currentYear} (as of {getShortMonthName(currentMonth)}). Variance = Forecast − Budget.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(currentYear)} onValueChange={(v) => setCurrentYear(Number(v))}>
            <SelectTrigger className="w-full sm:w-[100px]">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(currentMonth)} onValueChange={(v) => setCurrentMonth(Number(v))}>
            <SelectTrigger className="w-full sm:w-[110px]">
              <SelectValue placeholder="As of month" />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {profile?.role === "hq_admin" && selectedBranch === ALL_BRANCHES_ID && regionsList.length > 0 && (
            <Select value={selectedRegionId} onValueChange={setSelectedRegionId}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_REGIONS_ID}>All regions (HQ total)</SelectItem>
                {regionsList.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {showBranchSelector && (
            <Select value={branchSelectorValue} onValueChange={(v) => { setSelectedBranch(v); if (v !== ALL_BRANCHES_ID) setSelectedRegionId(ALL_REGIONS_ID) }}>
              <SelectTrigger className="w-full sm:w-[260px]">
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {profile?.role !== "branch_user" && (
                  <SelectItem value={ALL_BRANCHES_ID}>
                    {profile?.role === "region_admin" ? "All branches in region (summary)" : "All branches (summary)"}
                  </SelectItem>
                )}
                {(() => {
                  const byRegion = new Map<string, Branch[]>()
                  branches.forEach((b) => {
                    const regionName = b.regions?.name ?? "Other"
                    if (!byRegion.has(regionName)) byRegion.set(regionName, [])
                    byRegion.get(regionName)!.push(b)
                  })
                  const sortedRegions = [...byRegion.keys()].sort()
                  return sortedRegions.map((regionName) => (
                    <SelectGroup key={regionName}>
                      <SelectLabel>{regionName}</SelectLabel>
                      {byRegion.get(regionName)!.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))
                })()}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            onClick={exportToCSV}
            disabled={forecasts.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          {profile?.role === "hq_admin" && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="mr-2 h-4 w-4" />
                {selectedFile ? selectedFile.name : "Select Actuals File"}
              </Button>
              {selectedFile && (
                <Button
                  onClick={handleUploadActuals}
                  disabled={uploading}
                >
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold">How the 2026 forecasts are generated</CardTitle>
          <CardDescription>
            This app uses Seasonal naive + growth + driver-based adjustments: 2025 seasonal pattern with YoY growth from 2024→2025, plus working days and seasonal index (unbiased, no budget input).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMethodology((v) => !v)}
            >
              {showMethodology ? "Hide full explanation" : "Read full explanation"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadMethodologyPdf}
            >
              <Download className="mr-2 h-4 w-4" />
              Download as PDF
            </Button>
          </div>

          {showMethodology && (
            <div className="prose prose-sm max-w-none text-muted-foreground space-y-2 mt-3">
              <p>
                The 2026 forecasts are generated entirely from historical data stored in Supabase – no 2026 actuals are used and there is no manual tuning to force the numbers toward any target.
                The input data consists of:
              </p>
              <ul className="list-disc pl-5">
                <li>
                  <strong>Actuals:</strong> 2023–2025 branch-level monthly actuals imported from the workbook using the import scripts.
                </li>
                <li>
                  <strong>Budgets:</strong> 2026 branch-level monthly budgets imported from the per-branch 2026 budget files (used for comparison only, not for forecasting).
                </li>
              </ul>
              <p>
                For each branch and each line item (for example <strong>TOTAL NET REVENUE</strong> or a specific expense line), we use a 36-month history (2023–2025). The series is cleaned by mapping description names consistently across years and deduplicating any duplicated (year, month, description) rows per branch.
              </p>
              <p>
                The forecast uses <strong>Seasonal naive + growth</strong> with a driver-based layer: it keeps the seasonal pattern from 2025 (which month is high/low), applies the YoY growth rate from 2024→2025, then adjusts for working days and a global seasonal index. No budget is used as input – the model is unbiased.
              </p>
              <p>
                Formula per branch and line item:
              </p>
              <ol className="list-decimal pl-5">
                <li>Start with 2025 same month (or 2024 if 2025 missing).</li>
                <li>growth = (2025_annual ÷ 2024_annual) − 1 (or 0 if prior year has no data).</li>
                <li>base[m] = max(0, 2025[m] × (1 + growth)).</li>
                <li>Apply working days: base[m] × (wd_2026[m] ÷ wd_2025[m]).</li>
                <li>Apply seasonal index (global pattern from 2023–2025 history).</li>
              </ol>
              <p>
                The key point is that the model uses only 2023–2025 history – no budget input. When we
                generate 2026 forecasts, we do not look at 2026 actuals or adjust forecasts to match any known 2026 figures. This makes the 2026 numbers true model forecasts, suitable for honest
                forecast-versus-budget comparison at branch, region, and HQ level.
              </p>
              <p>
                The dashboard you are viewing simply reads these precomputed 2026 forecasts from Supabase, aggregates them by branch, region, or HQ, and displays the variance between <strong>forecast</strong> and
                <strong> budget</strong> for the selected month, category, and level.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {selectedBranch === ALL_BRANCHES_ID && (
        <Alert className="bg-muted/50">
          <AlertDescription>
            {profile?.role === "region_admin"
              ? "Region level: summation of forecast and budget for all branches in your region. Compare variance below; select a branch to see branch-level detail."
              : selectedRegionId && selectedRegionId !== ALL_REGIONS_ID
                ? "Region level: budget and forecast totals for this region. Compare variance below; select a branch to drill down or choose another region above."
                : "HQ level: budget and forecast totals for all branches. Use the Region dropdown to view a single region, or select a branch for branch detail."}
          </AlertDescription>
        </Alert>
      )}
      {selectedBranch && selectedBranch !== ALL_BRANCHES_ID && (
        <Alert className="bg-muted/50">
          <AlertDescription>
            {profile?.role === "branch_user"
              ? "Branch level: budget and forecast for your branch. Mark a month as Forecasted when it is finalized; that month locks until HQ or your region admin unlocks it for rework."
              : profile?.role === "region_admin"
                ? "Branch level: budget and forecast for branches in your region. Variance = Forecast − Budget. Mark a month as Forecasted when it is finalized, or unlock it for rework. Completed months are locked until HQ unlocks them."
                : "Branch level: budget and forecast for this branch. Variance = Forecast − Budget. Completed months are locked until HQ or your region admin unlocks them for rework."}
          </AlertDescription>
        </Alert>
      )}

      {(selectedBranch === ALL_BRANCHES_ID || (selectedBranch && selectedBranch !== ALL_BRANCHES_ID)) && (loading || forecasts.length > 0) && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{viewLevelLabel}</Badge>
            <span className="min-w-0">
              {loading ? "Loading…" : "— comparing budget to forecast for selected month"}
            </span>
          </div>
          {!loading && forecasts.length > 0 && hasFullYearData && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {currentYear} full year · Revenue
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">Forecast {formatCurrency(annualRevenueForecast)}</div>
                  <p className="text-xs text-muted-foreground">Budget {formatCurrency(annualRevenueBudget)}</p>
                  {/* <p className={cn("text-xs mt-1 font-medium", annualRevenueForecast >= annualRevenueBudget ? "text-accent" : "text-destructive")}>
                    Variance {annualRevenueForecast >= annualRevenueBudget ? "+" : ""}{formatCurrency(annualRevenueForecast - annualRevenueBudget)}
                  </p> */}
                </CardContent>
              </Card>
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {currentYear} full year · Expenses
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">Forecast {formatCurrency(annualExpenseForecast)}</div>
                  <p className="text-xs text-muted-foreground">Budget {formatCurrency(annualExpenseBudget)}</p>
                  {/* <p className={cn("text-xs mt-1 font-medium", annualExpenseForecast <= annualExpenseBudget ? "text-accent" : "text-destructive")}>
                    Variance {annualExpenseForecast <= annualExpenseBudget ? "" : "+"}{formatCurrency(annualExpenseForecast - annualExpenseBudget)}
                  </p> */}
                </CardContent>
              </Card>
              <Card className="border-accent/20 bg-accent/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {currentYear} full year · Contribution B/4 Overhead
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">Forecast {formatCurrency(annualContributionForecast)}</div>
                  <p className="text-xs text-muted-foreground">Budget {formatCurrency(annualContributionBudget)}</p>
                  {/* <p className={cn("text-xs mt-1 font-medium", annualContributionForecast >= annualContributionBudget ? "text-accent" : "text-destructive")}>
                    Variance {annualContributionForecast >= annualContributionBudget ? "+" : ""}{formatCurrency(annualContributionVariance)}
                  </p> */}
                </CardContent>
              </Card>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading ? (
              <>
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2">
                      <Skeleton className="h-4 w-24" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-8 w-28 mb-2" />
                      <Skeleton className="h-3 w-20" />
                    </CardContent>
                  </Card>
                ))}
              </>
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Monthly Revenue · {getShortMonthName(currentMonth)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(revenueForecast)}</div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-muted-foreground">Budget: {formatCurrency(revenueBudget)}</p>
                      <p className={cn("text-xs font-medium", revenueVariance >= 0 ? "text-accent" : "text-destructive")}>
                        {formatPercent(revenueVariancePct)}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Monthly Expenses · {getShortMonthName(currentMonth)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(expenseForecast)}</div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-muted-foreground">Budget: {formatCurrency(expenseBudget)}</p>
                      <p className={cn("text-xs font-medium", expenseVariance <= 0 ? "text-accent" : "text-destructive")}>
                        {formatPercent(expenseVariancePct)}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-accent/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Contribution B/4 Overhead · {getShortMonthName(currentMonth)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(contributionForecast)}</div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-muted-foreground">Budget: {formatCurrency(contributionBudget)}</p>
                      <p className={cn("text-xs font-medium", contributionVariance >= 0 ? "text-accent" : "text-destructive")}>
                        {formatPercent(contributionPct)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {selectedBranch === ALL_BRANCHES_ID && branchBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Branch contribution · {getShortMonthName(currentMonth)} {currentYear}</CardTitle>
                <CardDescription>
                  Each branch&apos;s contribution to revenue and expenses. Compare side by side.
                </CardDescription>
              </CardHeader>
              <Collapsible open={branchContributionOpen} onOpenChange={setBranchContributionOpen}>
                <div className="flex justify-end px-6 pt-1">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-muted-foreground">
                      {branchContributionOpen ? "Hide" : "Show"}
                      <ChevronDown className={cn("size-4 transition-transform duration-200", branchContributionOpen ? "rotate-180" : "rotate-0")} />
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-2 font-medium">Branch</th>
                        <th className="text-right py-3 px-2 font-medium">Revenue (F)</th>
                        <th className="text-right py-3 px-2 font-medium">Revenue (B)</th>
                        <th className="text-right py-3 px-2 font-medium">Expense (F)</th>
                        <th className="text-right py-3 px-2 font-medium">Expense (B)</th>
                        <th className="text-right py-3 px-2 font-medium">Contrib B/4 OH (F)</th>
                        <th className="text-right py-3 px-2 font-medium">Contrib B/4 OH (B)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchBreakdown.map((row) => (
                        <tr key={row.branch.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 px-2 font-medium">
                            <button
                              type="button"
                              onClick={() => setSelectedBranch(row.branch.id)}
                              className="text-primary hover:underline text-left inline-flex flex-col items-start gap-0.5"
                            >
                              <span>{row.branch.name}</span>
                              <span className="text-[10px] text-muted-foreground font-normal uppercase">{row.branch.code}</span>
                            </button>
                          </td>
                          <td className="text-right py-2 px-2">{formatCurrency(row.revenueForecast)}</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">{formatCurrency(row.revenueBudget)}</td>
                          <td className="text-right py-2 px-2">{formatCurrency(row.expenseForecast)}</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">{formatCurrency(row.expenseBudget)}</td>
                          <td className="text-right py-2 px-2 font-bold">{formatCurrency(row.contribForecast)}</td>
                          <td className="text-right py-2 px-2">
                            <div className="flex flex-col items-end">
                              <span className="text-muted-foreground">{formatCurrency(row.contribBudget)}</span>
                              <span className={cn("text-[10px] font-medium", (row.contribForecast - row.contribBudget) >= 0 ? "text-accent" : "text-destructive")}>
                                {(row.contribForecast - row.contribBudget) >= 0 ? "+" : ""}{formatCurrency(row.contribForecast - row.contribBudget)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-muted/30 font-bold">
                        <td className="py-3 px-2">HQ Total ({branchBreakdown.length} branches)</td>
                        <td className="text-right py-3 px-2">
                          {formatCurrency(branchBreakdown.reduce((sum, b) => sum + b.revenueForecast, 0))}
                        </td>
                        <td className="text-right py-3 px-2">
                          {formatCurrency(branchBreakdown.reduce((sum, b) => sum + b.revenueBudget, 0))}
                        </td>
                        <td className="text-right py-3 px-2">
                          {formatCurrency(branchBreakdown.reduce((sum, b) => sum + b.expenseForecast, 0))}
                        </td>
                        <td className="text-right py-3 px-2">
                          {formatCurrency(branchBreakdown.reduce((sum, b) => sum + b.expenseBudget, 0))}
                        </td>
                        <td className="text-right py-3 px-2">
                          {formatCurrency(branchBreakdown.reduce((sum, b) => sum + b.contribForecast, 0))}
                        </td>
                        <td className="text-right py-3 px-2">
                          {formatCurrency(branchBreakdown.reduce((sum, b) => sum + b.contribBudget, 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4">
                <div>
                  <CardTitle>Budget vs Forecast by Category</CardTitle>
                  <CardDescription>Monthly breakdown: budget and forecast by line item. Variance = Forecast − Budget. Use search and filter to narrow results.</CardDescription>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="relative flex-1 w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search categories..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={selectedDescription} onValueChange={setSelectedDescription}>
                    <SelectTrigger className="w-full sm:w-[200px]">
                      <SelectValue placeholder="Filter by category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {descriptions.map((desc) => (
                        <SelectItem key={desc} value={desc}>
                          {desc}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(searchQuery.trim() || selectedDescription !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSearchQuery("")
                        setSelectedDescription("all")
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {selectedBranch === ALL_BRANCHES_ID && profile?.role !== "branch_user" && (
                <div className="mb-4 flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/40 rounded-md p-3 border border-amber-200 dark:border-amber-800">
                  <Pencil className="h-4 w-4 shrink-0" />
                  <span>To edit forecast values, select a specific branch from the dropdown above or click a branch name in the Branch contribution table. Hover any line item to see its branch-by-branch breakdown.</span>
                </div>
              )}
              {selectedBranch !== ALL_BRANCHES_ID && (
                <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
                  <Pencil className="h-4 w-4" />
                  <span>Click on any cell in the table view to adjust forecast values by description and month.</span>
                </div>
              )}
              <Tabs defaultValue="chart">
                <TabsList>
                  <TabsTrigger value="chart">Chart</TabsTrigger>
                  <TabsTrigger value="line">Line Graph</TabsTrigger>
                  <TabsTrigger value="table">Table</TabsTrigger>
                </TabsList>
                <TabsContent value="chart" className="mt-4">
                  <ForecastBarChart
                    forecasts={chartForecasts}
                    currentMonth={currentMonth}
                  />
                </TabsContent>
                <TabsContent value="line" className="mt-4">
                  <ForecastChart
                    forecasts={chartForecasts}
                    currentMonth={currentMonth}
                  />
                </TabsContent>
                <TabsContent value="table" className="mt-4">
                  {loading && activeScopeKey !== buildScopeKey(selectedBranch, selectedRegionId, currentYear, currentMonth, selectedBranch === ALL_BRANCHES_ID ? branches.length : 0) ? (
                    <div className="space-y-2 py-2" aria-hidden>
                      {Array.from({ length: 10 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-full" />
                      ))}
                    </div>
                  ) : (
                    <ForecastTable
                      forecasts={filteredForecasts}
                      currentMonth={currentMonth}
                      autoScrollKey={`${selectedBranch}-${currentYear}-${currentMonth}`}
                      targetDescription={descriptionFromUrl}
                      onUpdateForecast={handleUpdateForecast}
                      editable={selectedBranch !== ALL_BRANCHES_ID}
                      lastMonthActuals={processedLastMonthActuals}
                      editedCells={editedCells}
                      monthStatuses={monthStatuses}
                      lockedMonths={completedMonths}
                      onCompleteMonth={canCompleteForecastMonth ? (month, note) => setForecastMonthStatus(month, true, note) : undefined}
                      onUnlockMonth={canUnlockForecastMonth ? (month, note) => setForecastMonthStatus(month, false, note) : undefined}
                      monthActionLoading={monthStatusActionMonth}
                      workingDaysMap={workingDays}
                      onUpdateWorkingDays={profile?.role === "hq_admin" ? handleUpdateWorkingDays : undefined}
                      currentYear={currentYear}
                      isSummary={selectedBranch === ALL_BRANCHES_ID}
                      summaryBranchIds={summaryBranchIds}
                      branchMeta={branchMeta}
                      summaryBranchMetrics={summaryBranchMetrics}
                      breakdownVersion={breakdownVersion}
                      onSelectBranch={handleSelectBranch}
                    />
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </>
      )}

      {(selectedBranch === ALL_BRANCHES_ID || selectedBranch) && loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">
              {selectedBranch === ALL_BRANCHES_ID ? "Loading summary…" : "Loading your branch data…"}
            </p>
          </CardContent>
        </Card>
      )}

      {selectedBranch === ALL_BRANCHES_ID && forecasts.length === 0 && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <LineChart className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold">
              {profile?.role === "region_admin" && branches.length === 0
                ? "No branches in your region"
                : "No Summary Data Yet"}
            </h2>
            <p className="text-muted-foreground mt-2 text-center max-w-md">
              {profile?.role === "region_admin" && branches.length === 0 ? (
                <>Your region has no branches assigned. Contact your administrator to assign branches to your region.</>
              ) : profile?.role === "region_admin" ? (
                <>No forecast data has been generated for the branches in your region yet. Forecasts are derived from imported Excel data. Contact your administrator to import data, or select a branch below to check if it has forecasts.</>
              ) : (
                <>Forecasts are derived from each branch&apos;s three-year data. Select a branch to view its forecasts; the summary here will show totals once branch forecasts are available.</>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {selectedBranch && selectedBranch !== ALL_BRANCHES_ID && forecasts.length === 0 && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <LineChart className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold">No Forecasts Yet</h2>
            <p className="text-muted-foreground mt-2 text-center max-w-md">
              Forecasts are derived from this branch&apos;s pre-loaded three-year data. They will appear here when available.
            </p>
          </CardContent>
        </Card>
      )}

      {!selectedBranch && profile?.role === "branch_user" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <LineChart className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold">Branch not assigned</h2>
            <p className="text-muted-foreground mt-2 text-center max-w-md">
              Your account is not assigned to a branch. Contact your administrator to get access.
            </p>
          </CardContent>
        </Card>
      )}

      {!selectedBranch && profile?.role !== "branch_user" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <LineChart className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold">Select a Branch</h2>
            <p className="text-muted-foreground mt-2">
              Choose a branch to view forecasts.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
