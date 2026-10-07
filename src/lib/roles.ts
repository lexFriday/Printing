import type { AppRole } from "@/hooks/useAuth";

export function defaultLandingForRole(role: AppRole | null) {
  if (role === "production") return "/production" as const;
  if (role === "sales") return "/quotes" as const;
  return "/dashboard" as const;
}

export function canManageUsers(role: AppRole | null) {
  return role === "owner";
}

export function canSalesWork(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "sales" || role === "staff";
}

export function canAccountingWork(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "accounting" || role === "staff";
}

/** Financial records change reported cash and project profit, so they need an accounting role. */
export function canManageMoneyOut(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "accounting";
}

export function canCreateCustomerInvoices(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "sales" || role === "accounting";
}

export function canControlJobs(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "staff";
}

export function canViewJobOrders(role: AppRole | null) {
  return canAccountingWork(role) || canViewFullReports(role) || role === "production";
}

export function canExecuteProduction(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "staff" || role === "production";
}

export function canAssignProduction(role: AppRole | null) {
  return role === "owner" || role === "admin";
}

export function canOperateInventory(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "staff" || role === "production";
}

export function canOperatePurchasing(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "staff";
}

export function canManageOperationalSettings(role: AppRole | null) {
  return role === "owner" || role === "admin";
}

export function canApproveOperationalException(role: AppRole | null) {
  return role === "owner" || role === "admin";
}

export function canCreateJobOrders(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "staff";
}

export function canManagerApproveQuotes(role: AppRole | null) {
  return role === "owner" || role === "admin";
}

export function canReopenQuotes(role: AppRole | null) {
  return role === "owner" || role === "admin";
}

export function canDeleteQuoteAttachments(role: AppRole | null) {
  return role === "owner" || role === "admin";
}

export function canViewFullReports(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "staff";
}

export function canViewSensitiveOperations(role: AppRole | null) {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "sales" ||
    role === "accounting" ||
    role === "staff"
  );
}

export function canViewMoneyWork(role: AppRole | null) {
  return role === "owner" || role === "admin" || role === "accounting" || role === "staff";
}

export function canReadOnly(role: AppRole | null) {
  return !!role;
}

export function canViewStatusOnly(role: AppRole | null) {
  return role === "viewer";
}
