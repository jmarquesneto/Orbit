'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Budget, BudgetSummary, Category, Goal, Invoice, Transaction, Wallet } from './types';

export const keys = {
  budgets: ['budgets'] as const,
  wallets: ['wallets'] as const,
  goals: ['goals'] as const,
  summary: (budgetId: string, month: string) => ['summary', budgetId, month] as const,
  categories: (budgetId: string) => ['categories', budgetId] as const,
  transactions: (budgetId: string, month?: string) => ['transactions', budgetId, month ?? 'all'] as const,
  invoices: (cardId: string) => ['invoices', cardId] as const,
};

export const useBudgets = () =>
  useQuery({ queryKey: keys.budgets, queryFn: () => api<{ budgets: Budget[] }>('/budgets').then((r) => r.budgets) });

export const useWallets = () =>
  useQuery({ queryKey: keys.wallets, queryFn: () => api<{ wallets: Wallet[] }>('/wallets').then((r) => r.wallets) });

export const useGoals = () =>
  useQuery({ queryKey: keys.goals, queryFn: () => api<{ goals: Goal[] }>('/goals').then((r) => r.goals) });

export const useCategories = (budgetId: string | undefined) =>
  useQuery({
    queryKey: keys.categories(budgetId ?? ''),
    queryFn: () => api<{ categories: Category[] }>(`/budgets/${budgetId}/categories`).then((r) => r.categories),
    enabled: Boolean(budgetId),
  });

export const useTransactions = (budgetId: string | undefined, month?: string) =>
  useQuery({
    queryKey: keys.transactions(budgetId ?? '', month),
    queryFn: () =>
      api<{ transactions: Transaction[] }>(
        `/budgets/${budgetId}/transactions${month ? `?month=${month}` : ''}`,
      ).then((r) => r.transactions),
    enabled: Boolean(budgetId),
  });

export const useInvoices = (cardId: string | undefined) =>
  useQuery({
    queryKey: keys.invoices(cardId ?? ''),
    queryFn: () => api<{ invoices: Invoice[] }>(`/wallets/${cardId}/invoices`).then((r) => r.invoices),
    enabled: Boolean(cardId),
  });

/** Resumo do mês de vários orçamentos em paralelo. */
export const useSummaries = (budgetIds: string[], month: string) =>
  useQueries({
    queries: budgetIds.map((id) => ({
      queryKey: keys.summary(id, month),
      queryFn: () => api<{ summary: BudgetSummary }>(`/budgets/${id}/summary?month=${month}`).then((r) => r.summary),
    })),
  });

export const useAllInvoices = (cardIds: string[]) =>
  useQueries({
    queries: cardIds.map((id) => ({
      queryKey: keys.invoices(id),
      queryFn: () => api<{ invoices: Invoice[] }>(`/wallets/${id}/invoices`).then((r) => r.invoices),
    })),
  });
