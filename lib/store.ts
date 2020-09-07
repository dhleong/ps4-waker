import axios, { AxiosInstance } from 'axios';

const SEARCH_PATTERN = 'https://store.playstation.com/store/api/chihiro/00_09_000/tumbler/$country/$language/99/$query?suggested_size=10';

const DEFAULT_PLATFORMS = ['PS4'];

// NOTE: I'm not sure what eslint thinks this is shadowing...
// eslint-disable-next-line no-shadow
export enum SearchResultType {
    Game,
    App,
}

export interface ISearchResult {
    id: string;
    name: string;
    type: SearchResultType;
}

function extractTitleId(id: string) {
    const parts = id.split(/[-_]/);
    return parts[1];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resultTypeOf(item: any): SearchResultType | undefined {
    switch (item.game_contentType) {
    case 'Full Game':
        return SearchResultType.Game;

    case 'App':
        return SearchResultType.App;

    default:
    }
}

export interface IStoreConfig {
    country: string;
    language: string;
    platforms: string[];
}

const defaultStoreConfig: IStoreConfig = {
    country: 'US',
    language: 'en',
    platforms: DEFAULT_PLATFORMS,
};

export default class StoreClient {

    private readonly searchPattern: string;

    private readonly supportedPlatforms: Set<string>;

    constructor(
        config: Partial<IStoreConfig> = {},
        private readonly client: AxiosInstance = axios.create({}),
    ) {
        const filledConfig = {
            ...defaultStoreConfig,
            ...config,
        };

        this.supportedPlatforms = new Set(filledConfig.platforms);
        this.searchPattern = SEARCH_PATTERN
            .replace('$country', filledConfig.country)
            .replace('$language', filledConfig.language);
    }

    async search(query: string) {
        const url = this.searchPattern.replace('$query', query);
        const { data } = await this.client.get(url);

        const matches: ISearchResult[] = [];
        const foundIds = new Set<string>();

        for (const link of data.links) {
            const type = resultTypeOf(link);
            if (type === undefined) continue;

            // is this playable on our target platform?
            const platformsObj = link.metadata.playable_platform;
            if (!platformsObj || !this.canPlay(platformsObj.values)) {
                // not a supported platform---not a valid candidate
                continue;
            }

            // the API tends to return seemingly duplicate results
            // for... some reason.
            const id = extractTitleId(link.id);
            if (foundIds.has(id)) continue;
            foundIds.add(id);

            matches.push({
                id,
                name: link.name,
                type,
            });
        }

        return matches;
    }

    private canPlay(platforms: string[]) {
        return platforms.find((p) => this.supportedPlatforms.has(p));
    }
}
