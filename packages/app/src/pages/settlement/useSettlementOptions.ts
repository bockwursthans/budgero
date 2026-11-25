import { useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import type { Account, Category, CategoryGroup } from '@budgero/core/browser';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useCategories, useCategoryGroups } from '@entities/category/api/useCategories';
import { INCOME_GROUP_NAME, TRANSFERS_GROUP_NAME } from '@pages/analytics/analytics-model';
import type { MultiSelectFilterGroup } from '@pages/analytics/components/MultiSelectFilterControl';
import type { SettlementOption } from './components/SettlementMultiSelect';

export interface SettlementOptions {
  accountGroups: MultiSelectFilterGroup<SettlementOption>[];
  /** Every category except transfers, grouped like the budget. */
  categoryGroups: MultiSelectFilterGroup<SettlementOption>[];
  /** Categories of the budget's Income group: the default income categories. */
  incomeCategoryIds: number[];
  isLoading: boolean;
}

const ACCOUNT_GROUP_KEY = { budget: 'budget', tracking: 'tracking' } as const;

const toOption = (item: { ID: number; Name: string }): SettlementOption => ({
  id: item.ID,
  name: item.Name,
});

function accountGroupsOf(
  accounts: readonly Account[],
  headings: { budget: string; tracking: string }
): MultiSelectFilterGroup<SettlementOption>[] {
  const open = accounts.filter((account) => !account.Archived && !account.Deleted);
  const budget = open.filter((account) => account.OnBudget).map(toOption);
  const tracking = open.filter((account) => !account.OnBudget).map(toOption);
  return [
    { key: ACCOUNT_GROUP_KEY.budget, heading: headings.budget, items: budget },
    ...(tracking.length > 0
      ? [{ key: ACCOUNT_GROUP_KEY.tracking, heading: headings.tracking, items: tracking }]
      : []),
  ];
}

function categoryGroupsOf(
  groups: readonly CategoryGroup[],
  categories: readonly Category[]
): MultiSelectFilterGroup<SettlementOption>[] {
  return groups
    .filter((group) => group.Name !== TRANSFERS_GROUP_NAME)
    .map((group) => ({
      key: group.ID,
      heading: group.Name,
      items: categories.filter((category) => category.CategoryGroupID === group.ID).map(toOption),
    }))
    .filter((group) => group.items.length > 0);
}

/** Accounts and categories to pick from in the settlement setup. */
export function useSettlementOptions(budgetId: number): SettlementOptions {
  const { t } = useLingui();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts(budgetId);
  const { data: categories = [], isLoading: categoriesLoading } = useCategories(budgetId);
  const { data: groups = [], isLoading: groupsLoading } = useCategoryGroups(budgetId);

  return useMemo(() => {
    const incomeGroup = groups.find((group) => group.Name === INCOME_GROUP_NAME);
    return {
      accountGroups: accountGroupsOf(accounts, {
        budget: t`Budget accounts`,
        tracking: t`Tracking accounts`,
      }),
      categoryGroups: categoryGroupsOf(groups, categories),
      incomeCategoryIds: categories
        .filter((category) => category.CategoryGroupID === incomeGroup?.ID)
        .map((category) => category.ID),
      isLoading: accountsLoading || categoriesLoading || groupsLoading,
    };
  }, [accounts, categories, groups, accountsLoading, categoriesLoading, groupsLoading, t]);
}
