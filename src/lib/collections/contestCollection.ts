import type { Contest } from '../queries/contestQueries.ts';
import {
  cycleTableState,
  getSortedAuthors,
  nextSortDirection,
  sortByDifficulty,
  sortByScore,
  type SortDirection
} from '../utils/table.ts';

export type ParticipationFilter = 'all' | 'participated' | 'not-participated';
export type ContestTypeFilter = 'all' | 'icpc' | 'codeforces';

const PARTICIPATION_FILTER_STATES = ['all', 'participated', 'not-participated'] as const;
const TYPE_FILTER_STATES = ['all', 'icpc', 'codeforces'] as const;

type ContestCollectionState = {
  sourceItems: readonly Contest[];
  participatedContestIds: ReadonlySet<string>;
  selectedAuthor: string | null;
  participationFilter: ParticipationFilter;
  typeFilter: ContestTypeFilter;
  difficultySortDirection: SortDirection;
};

export type CreateContestCollectionOptions = {
  items?: readonly Contest[];
  participatedContestIds?: ReadonlySet<string>;
  selectedAuthor?: string | null;
  participationFilter?: ParticipationFilter;
  typeFilter?: ContestTypeFilter;
  difficultySortDirection?: SortDirection;
  preserveSourceOrder?: boolean;
};

function sortByDefaultScore(items: readonly Contest[]): Contest[] {
  return sortByScore(items, 'desc');
}

export class ContestCollection {
  readonly sourceItems: readonly Contest[];
  readonly participatedContestIds: ReadonlySet<string>;
  readonly selectedAuthor: string | null;
  readonly participationFilter: ParticipationFilter;
  readonly typeFilter: ContestTypeFilter;
  readonly difficultySortDirection: SortDirection;

  constructor(options: CreateContestCollectionOptions = {}) {
    this.sourceItems = options.preserveSourceOrder
      ? [...(options.items ?? [])]
      : sortByDefaultScore(options.items ?? []);
    this.participatedContestIds = new Set(options.participatedContestIds ?? []);
    this.selectedAuthor = options.selectedAuthor ?? null;
    this.participationFilter = options.participationFilter ?? 'all';
    this.typeFilter = options.typeFilter ?? 'all';
    this.difficultySortDirection = options.difficultySortDirection ?? null;
  }

  get sortKey(): 'score' | 'difficulty' {
    return this.difficultySortDirection === null ? 'score' : 'difficulty';
  }

  get availableAuthors(): string[] {
    return getSortedAuthors(this.withoutAuthorFilter);
  }

  get rows(): Contest[] {
    const filtered = this.selectedAuthor
      ? this.withoutAuthorFilter.filter((contest) => contest.addedBy === this.selectedAuthor)
      : this.withoutAuthorFilter;
    return this.difficultySortDirection === null
      ? [...filtered]
      : sortByDifficulty(filtered, this.difficultySortDirection, sortByDefaultScore);
  }

  withSourceItems(items: readonly Contest[]): ContestCollection {
    return this.copy({ sourceItems: sortByDefaultScore(items) });
  }

  replaceSourceItem(item: Contest): ContestCollection {
    return this.copy({
      sourceItems: this.sourceItems.map((contest) => (contest.id === item.id ? item : contest))
    });
  }

  withParticipatedContestIds(ids: ReadonlySet<string>): ContestCollection {
    return this.copy({ participatedContestIds: new Set(ids) });
  }

  selectAuthor(author: string | null): ContestCollection {
    return this.copy({ selectedAuthor: author });
  }

  cycleParticipationFilter(): ContestCollection {
    return this.copy({
      participationFilter: cycleTableState(this.participationFilter, PARTICIPATION_FILTER_STATES)
    });
  }

  cycleTypeFilter(): ContestCollection {
    return this.copy({ typeFilter: cycleTableState(this.typeFilter, TYPE_FILTER_STATES) });
  }

  cycleDifficultySort(): ContestCollection {
    const direction = nextSortDirection(this.difficultySortDirection);
    return this.copy({
      sourceItems: direction === null ? sortByDefaultScore(this.sourceItems) : this.sourceItems,
      difficultySortDirection: direction
    });
  }

  resetFilters(): ContestCollection {
    return this.copy({
      sourceItems: sortByDefaultScore(this.sourceItems),
      selectedAuthor: null,
      participationFilter: 'all',
      typeFilter: 'all',
      difficultySortDirection: null
    });
  }

  private get withoutAuthorFilter(): Contest[] {
    return this.sourceItems.filter((contest) => {
      if (this.participationFilter !== 'all' && contest.id) {
        const participated = this.participatedContestIds.has(contest.id);
        if (this.participationFilter === 'participated' ? !participated : participated) {
          return false;
        }
      }

      if (this.typeFilter === 'icpc' && contest.type !== 'ICPC') return false;
      if (this.typeFilter === 'codeforces' && contest.type === 'ICPC') return false;
      return true;
    });
  }

  private copy(changes: Partial<ContestCollectionState>): ContestCollection {
    return new ContestCollection({
      items: changes.sourceItems ?? this.sourceItems,
      participatedContestIds: changes.participatedContestIds ?? this.participatedContestIds,
      selectedAuthor: 'selectedAuthor' in changes ? changes.selectedAuthor : this.selectedAuthor,
      participationFilter: changes.participationFilter ?? this.participationFilter,
      typeFilter: changes.typeFilter ?? this.typeFilter,
      difficultySortDirection:
        changes.difficultySortDirection === undefined
          ? this.difficultySortDirection
          : changes.difficultySortDirection,
      preserveSourceOrder: true
    });
  }
}
