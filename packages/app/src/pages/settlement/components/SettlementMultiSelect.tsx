import { useLingui } from '@lingui/react/macro';
import {
  MultiSelectFilterControl,
  type MultiSelectFilterGroup,
} from '@pages/analytics/components/MultiSelectFilterControl';

export interface SettlementOption {
  id: number;
  name: string;
}

interface SettlementMultiSelectProps {
  groups: MultiSelectFilterGroup<SettlementOption>[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  buttonLabel: string;
  searchPlaceholder: string;
  emptyText: string;
  /** Command value of the "none" entry; unique per control. */
  clearOptionValue: string;
  disabled?: boolean;
}

/**
 * Multi-select for the settlement setup. Unlike a report filter, an empty
 * selection means "none", so the first entry clears instead of picking all.
 */
export function SettlementMultiSelect({
  groups,
  selectedIds,
  onChange,
  buttonLabel,
  searchPlaceholder,
  emptyText,
  clearOptionValue,
  disabled,
}: SettlementMultiSelectProps) {
  const { t } = useLingui();
  return (
    <MultiSelectFilterControl
      groups={groups}
      selectedIds={selectedIds}
      onChange={onChange}
      getId={(option) => option.id}
      getLabel={(option) => option.name}
      isLoading={false}
      hasItems={groups.some((group) => group.items.length > 0)}
      buttonLabel={buttonLabel}
      triggerWidthClassName="w-full"
      contentClassName="w-[280px]"
      listClassName="max-h-[280px]"
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      allOptionLabel={t`None`}
      allOptionValue={clearOptionValue}
      disabled={disabled}
    />
  );
}
