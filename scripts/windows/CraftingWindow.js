import { Config } from "../config.js";
import PlayerSelectWindow from "./PlayerSelectWindow.js";
import { RecipeDatabase } from "../RecipeDatabase.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
export default class CraftingWindow extends HandlebarsApplicationMixin(ApplicationV2) {
    /**
     * Recipe Database
     *
     * @type {RecipeDatabase}
     */
    recipeDatabase = null;

    /**
     * Search Text Field
     */
    searchText = "";

    /**
     * Committed Search Text (for token display)
     * Only updated when Enter is pressed
     */
    committedSearchText = "";

    /**
     * Current sort column
     * @type {string|null}
     */
    sortColumn = null;

    /**
     * Current sort direction ('asc' or 'desc')
     * @type {string}
     */
    sortDirection = 'asc';

    #activeElementId = false;
    #cursorPosition = { start: 0, end: 0 };
    #debounceSchedule = false;
    #listenerAbort;

    /**
     * @param {RecipeDatabase} recipeDatabase
     * @param {ActorToken} token
     */
    constructor(recipeDatabase) {
        super();

        this.recipeDatabase = recipeDatabase;
    }

    static DEFAULT_OPTIONS = {
        id: "crafting-window",
        classes: ["helianas-harvesting-module", "themed", "theme-light"],
        position: { width: 800, height: 600 },
        window: { title: "HelianasHarvest.CraftWindowTitle", resize: true },
        tag: "div",
        actions: {
            openRecipe: CraftingWindow.prototype._onOpenRecipe,
            sortColumn: CraftingWindow.prototype._onSortColumn,
            removeFilterToken: CraftingWindow.prototype._onRemoveFilterToken
        }
    };

    static PARTS = {
        main: { template: Config.CraftWindowTemplate }
    };

    updateForm(newValues) {
        if (typeof newValues.searchText === "string") {
            this.searchText = newValues.searchText;
        }

        if (typeof newValues.sortColumn === "string") {
            // If clicking the same column, toggle direction
            if (this.sortColumn === newValues.sortColumn) {
                this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortColumn = newValues.sortColumn;
                this.sortDirection = 'asc';
            }
        }

        if (this.rendered) this.render();
    }

    /**
     * Parses search text to extract filter tokens for display
     * @param {string} text Search string
     * @returns {Array} Array of token objects {type, value, display}
     */
    #parseFilterTokens(text) {
        if (!text || !text.trim()) return [];

        const tokens = [];
        // Split by comma first, then by spaces within each part
        // This handles both "c:dragon, n:staff" and "c:dragon n:staff" formats
        const commaParts = text.split(',').map(p => p.trim()).filter(p => p.length > 0);

        for (const commaPart of commaParts) {
            // Split by spaces within each comma-separated part
            const spaceParts = commaPart.split(/\s+/).filter(p => p.trim().length > 0);

            for (const part of spaceParts) {
                const trimmed = part.trim();
                if (trimmed.startsWith('c:')) {
                    const value = trimmed.substring(2).trim();
                    if (value) {
                        tokens.push({
                            type: 'component',
                            value: value,
                            display: `c:${value}`,
                            fullText: trimmed
                        });
                    }
                } else if (trimmed.startsWith('n:')) {
                    const value = trimmed.substring(2).trim();
                    if (value) {
                        tokens.push({
                            type: 'name',
                            value: value,
                            display: `n:${value}`,
                            fullText: trimmed
                        });
                    }
                } else if (trimmed) {
                    // Regular keyword - we'll show it as a general token
                    tokens.push({
                        type: 'general',
                        value: trimmed,
                        display: trimmed,
                        fullText: trimmed
                    });
                }
            }
        }

        return tokens;
    }

    async _prepareContext(options) {
        // Combine committed tokens with current input for search
        // This allows real-time filtering while maintaining accumulated tokens
        let searchQuery = '';
        if (this.committedSearchText && this.searchText) {
            // Combine both: committed tokens + current input
            searchQuery = `${this.committedSearchText} ${this.searchText}`.trim();
        } else if (this.committedSearchText) {
            // Only committed tokens
            searchQuery = this.committedSearchText;
        } else {
            // Only current input (real-time search)
            searchQuery = this.searchText;
        }

        let recipes = this.recipeDatabase.searchItems(searchQuery);

        console.log('Preparing context');
        // Apply sorting
        if (this.sortColumn) {
            recipes = this.#sortRecipes(recipes, this.sortColumn, this.sortDirection);
        } else {
            // Default sort by name
            recipes = recipes.sort((a, b) => a.name.localeCompare(b.name));
        }

        // Prepare sort indicators for each column
        const sortIndicators = {
            name: this.sortColumn === 'name' ? (this.sortDirection === 'asc' ? '↑' : '↓') : '',
            rarity: this.sortColumn === 'rarity' ? (this.sortDirection === 'asc' ? '↑' : '↓') : '',
            price: this.sortColumn === 'price' ? (this.sortDirection === 'asc' ? '↑' : '↓') : '',
            metatag: this.sortColumn === 'metatag' ? (this.sortDirection === 'asc' ? '↑' : '↓') : '',
            components: this.sortColumn === 'components' ? (this.sortDirection === 'asc' ? '↑' : '↓') : ''
        };

        // Parse filter tokens for display (only from committed search text)
        const filterTokens = this.#parseFilterTokens(this.committedSearchText);

        return {
            rarityNames: game.system.config.itemRarity,
            recipes: recipes,
            searchText: this.searchText,
            sortColumn: this.sortColumn,
            sortDirection: this.sortDirection,
            sortIndicators: sortIndicators,
            filterTokens: filterTokens
        };
    }

    /**
     * Sort recipes by the specified column
     * @param {Array} recipes - Array of recipes to sort
     * @param {string} column - Column name to sort by
     * @param {string} direction - 'asc' or 'desc'
     * @returns {Array} Sorted recipes
     */
    #sortRecipes(recipes, column, direction) {
        const multiplier = direction === 'asc' ? 1 : -1;

        const rarityValues = {
            'common': 0,
            'uncommon': 1,
            'rare': 2,
            'veryRare': 3,
            'legendary': 4,
            'artifact': 5
        };

        console.log('Sorting recipes by', column, direction);
        return [...recipes].sort((a, b) => {
            let comparison = 0;

            switch (column) {
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'rarity':
                    const aRarityValue = rarityValues[a.rarity] ?? -1;
                    const bRarityValue = rarityValues[b.rarity] ?? -1;
                    comparison = aRarityValue - bRarityValue;
                    break;
                case 'price':
                    comparison = (a.price ?? 0) - (b.price ?? 0);
                    break;
                case 'metatag':
                    const aMetatag = a.metatag ?? '';
                    const bMetatag = b.metatag ?? '';
                    comparison = aMetatag.localeCompare(bMetatag);
                    break;
                case 'components':
                    // Sort by number of components, then by first component name
                    const aComponentCount = a.components?.length ?? 0;
                    const bComponentCount = b.components?.length ?? 0;
                    if (aComponentCount !== bComponentCount) {
                        comparison = aComponentCount - bComponentCount;
                    } else {
                        const aFirstComponent = a.components?.[0]?.name ?? '';
                        const bFirstComponent = b.components?.[0]?.name ?? '';
                        comparison = aFirstComponent.localeCompare(bFirstComponent);
                    }
                    break;
                default:
                    comparison = 0;
            }

            return comparison * multiplier;
        });
    }

    // Event Listeners
    _onFocusManaged(event, target) {
        this.#activeElementId = target.id;
        this.#cursorPosition = {
            start: target.selectionStart,
            end: target.selectionEnd
        };
    }

    _onBlurManaged(event, target) {
        this.#activeElementId = null;
        this.#cursorPosition = { start: 0, end: 0 };
    }

    _onInputManaged(event, target) {
        this.#activeElementId = target.id;
        this.#cursorPosition = {
            start: target.selectionStart,
            end: target.selectionEnd
        };

        if (this.#debounceSchedule) clearTimeout(this.#debounceSchedule);
        this.#debounceSchedule = setTimeout(() => this.#updateForm(target), 500);
    }

    _onChangeManaged(event, target) {
        this.#updateForm(target);
    }

    _onKeyDownManaged(event, target) {
        if (event.key === 'Enter') {
            event.preventDefault();

            const inputValue = target.value.trim();
            if (!inputValue) return;

            const hasTokenPrefix = inputValue.startsWith('c:') || inputValue.startsWith('n:') ||
                                   (inputValue.includes(',') && inputValue.split(',').some(part => {
                                       const trimmed = part.trim();
                                       return trimmed.startsWith('c:') || trimmed.startsWith('n:');
                                   }));

            if (!hasTokenPrefix) {
                this.updateForm({ searchText: inputValue });
                return;
            }

            const newTokens = [];

            if (inputValue.includes(',')) {
                // Split by comma and create separate tokens
                const commaParts = inputValue.split(',').map(p => p.trim()).filter(p => p.length > 0);
                for (const part of commaParts) {
                    const trimmed = part.trim();
                    if (trimmed.startsWith('c:')) {
                        const value = trimmed.substring(2).trim();
                        if (value) {
                            newTokens.push({
                                type: 'component',
                                value: value,
                                display: `c:${value}`,
                                fullText: trimmed
                            });
                        }
                    } else if (trimmed.startsWith('n:')) {
                        const value = trimmed.substring(2).trim();
                        if (value) {
                            newTokens.push({
                                type: 'name',
                                value: value,
                                display: `n:${value}`,
                                fullText: trimmed
                            });
                        }
                    }
                }
            } else {
                const trimmed = inputValue.trim();
                if (trimmed.startsWith('c:')) {
                    const value = trimmed.substring(2).trim();
                    if (value) {
                        newTokens.push({
                            type: 'component',
                            value: value,
                            display: `c:${value}`,
                            fullText: trimmed
                        });
                    }
                } else if (trimmed.startsWith('n:')) {
                    const value = trimmed.substring(2).trim();
                    if (value) {
                        newTokens.push({
                            type: 'name',
                            value: value,
                            display: `n:${value}`,
                            fullText: trimmed
                        });
                    }
                }
            }

            // Get existing committed tokens
            const existingTokens = this.#parseFilterTokens(this.committedSearchText);

            // Combine tokens, avoiding duplicates (based on fullText)
            const existingFullTexts = new Set(existingTokens.map(t => t.fullText));
            const uniqueNewTokens = newTokens.filter(t => !existingFullTexts.has(t.fullText));

            // Combine all committed tokens
            const allTokens = [...existingTokens, ...uniqueNewTokens];

            // Reconstruct committed search text from all tokens
            const tokenParts = allTokens.map(t => t.fullText);
            this.committedSearchText = tokenParts.join(' ').trim();

            // Clear the input field
            this.searchText = '';
            target.value = '';
            this.updateForm({ searchText: '' });
        }
    }

    #updateForm(target) {
        const input = {};
        input[target.dataset.binding] = target.value;
        this.updateForm(input);
    }

    async _onOpenRecipe(event, target) {
        event.preventDefault();
        const { itemName, itemLink } = target.dataset;
        await this.send(itemName, itemLink);
    }

    _onSortColumn(event, target) {
        event.preventDefault();
        const { sortColumn } = target.dataset;
        if (sortColumn) {
            this.updateForm({ sortColumn });
        }
    }

    _onRemoveFilterToken(event, target) {
        event.preventDefault();
        event.stopPropagation();
        const { tokenText } = target.dataset;

        if (tokenText && this.committedSearchText) {
            // Parse current tokens and remove the one being deleted
            const currentTokens = this.#parseFilterTokens(this.committedSearchText);
            const remainingTokens = currentTokens.filter(t => t.fullText !== tokenText);

            // Reconstruct search text from remaining tokens
            const parts = remainingTokens.map(t => t.fullText);
            const newSearchText = parts.join(' ').trim();

            // Update committed search text only, clear the input field
            this.committedSearchText = newSearchText;
            this.updateForm({ searchText: '' });
        }
    }

    _onRender(ctx, opts) {
        // restore cursor

        console.log(this.element);
        console.log(ctx, opts);
        console.log(this.#activeElementId);
        console.log(this.#cursorPosition);

        if (this.#activeElementId) {
            const el = this.element.querySelector(`#${this.#activeElementId}`);
            if (el) {
                el.focus();
                el.setSelectionRange?.(this.#cursorPosition.start, this.#cursorPosition.end);
            }
        }

        // re-wire listeners safely each render
        this.#listenerAbort?.abort();
        this.#listenerAbort = new AbortController();
        const { signal } = this.#listenerAbort;

        this.element.querySelectorAll('#recipe-search').forEach(el => {
            el.addEventListener('focus', e => this._onFocusManaged(e, e.currentTarget), { signal });
            //el.addEventListener('blur', e => this._onBlurManaged(e, e.currentTarget), { signal });
            el.addEventListener('input', e => this._onInputManaged(e, e.currentTarget), { signal });
            el.addEventListener('change', e => this._onChangeManaged(e, e.currentTarget), { signal });
            el.addEventListener('keydown', e => this._onKeyDownManaged(e, e.currentTarget), { signal });
        });

        // Wire up token removal buttons
        this.element.querySelectorAll('[data-action="removeFilterToken"]').forEach(el => {
            el.addEventListener('click', e => this._onRemoveFilterToken(e, e.currentTarget), { signal });
        });
    }

    close(options) {
        // ensure timers/listeners don’t leak
        this.#listenerAbort?.abort();
        if (this.#debounceSchedule) clearTimeout(this.#debounceSchedule);
        return super.close(options);
    }

    async send(itemName, itemLink) {
        const psw = new PlayerSelectWindow(`Select a player to send ${itemName}`);
        const playerSelect = await psw.selectPlayer();
        const actor = game.actors.get(playerSelect);
        const craftedItem = await fromUuid(itemLink);
        if (actor && craftedItem) {
            const recipe = this.recipeDatabase.getRecipeFromName(itemName);
            const createdItems = await actor.createEmbeddedDocuments("Item", [craftedItem]);
            const updates = [{
                "_id": createdItems[0].id,
                "name": recipe.name,
                "system.quantity": recipe.qty,
                "system.rarity": recipe.rarity,
                "system.price": { value: recipe.price, denomination: 'gp' }
            }];
            await actor.updateEmbeddedDocuments("Item", updates);

            this.sendChatMessage(game.i18n.format("HelianasHarvest.CraftingCreatedItemNotice", { actorName: actor.name, itemName: craftedItem.name }));
        }
    }

    sendChatMessage(message) {
        let chatMessage = {
            user: game.userId,
            speaker: ChatMessage.getSpeaker(),
            content: message
        };

        ChatMessage.create(chatMessage);
    }
}
