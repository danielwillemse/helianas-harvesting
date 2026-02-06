export class RecipeDatabase {
    _recipes = [];
    _cb = null;

    constructor(componentDatabase) {
        this._cb = componentDatabase;
    }

    addRecipe(recipe) {
        const fields = ["name", "source", "item", "mod", "price", "rarity", "qty", "metatag", "component", "variants", "includeBasePrice", "note"];

        // Handle Variant Recipes by cloning
        const variants = recipe.variants
        if (Array.isArray(variants)) {
            for (const alterations of variants) {
                if (typeof alterations === "object") {
                    if (!alterations.item && !alterations.mod) {
                        throw new Error(`Heliana's Harvesting | For ${recipe.name} recipe variants must specify either an 'item' link or a 'mod'`);
                    }
                    let clone = {...recipe};

                    fields.forEach(f => {
                        if (alterations.hasOwnProperty(f)) {
                            clone[f] = alterations[f];
                        }
                    });

                    // Remove variants so that we don't recurse
                    delete clone.variants;

                    // Add variants
                    this.addRecipe(clone);
                }
            }
            return;
        }

        // Duplicate recipe for each item link, if we get an array of item links
        if (Array.isArray(recipe.item)) {
            for (const newItem of recipe.item) {
                let clone = {...recipe};
                clone.item = newItem;
                this.addRecipe(clone);
            }
            return;
        }

        Object.getOwnPropertyNames(recipe).forEach(name => {
            if (!fields.includes(name)) {
                throw new Error(`Heliana's Harvesting | Unknown property ${name} on recipe ${recipe.name}`);
            }
        });

        this.#addItemInternal(recipe);
    }

    #addItemInternal(recipe) {
        const item = fromUuidSync(recipe.item);
        if (!item) {
            console.error(`Heliana's Harvesting | Unable to find item uuid ${recipe.item} on recipe ${recipe.name}`);
            return;
        }

        // Normalize recipe components to arrays for easier handling
        if (!Array.isArray(recipe.component)) recipe.component = [recipe.component];

        const components = recipe.component.map(c => {
            const component = this._cb.get(c);
            if (!component) {
                console.error(`Heliana's Harvesting | Unable to find component ${c} on recipe ${recipe.name}`)
            }
            return component;
        });

        const nameExtension = recipe.mod ? ` (${recipe.mod})` : ''
        const name = item.name + nameExtension;
        if (this.getRecipeFromName(name)) {
            throw new Error(`Heliana's Harvesting | Duplicated name for item: ${name}`)
        }

        this._recipes.push({
            name,
            img: item.img ?? "icons/svg/item-bag.svg",
            searchText: `${item.name} ${recipe.mod ?? ""} ${recipe.metatag ?? ""} ${components.map(c => c.name).join(" ")}`.toLowerCase(),
            metatag: recipe.metatag,
            rarity: recipe.rarity,
            price: recipe.price,
            link: recipe.item,
            qty: recipe.qty ?? 1,
            includeBasePrice: recipe.includeBasePrice === true,
            components
        });
    }

    /**
     * Parses search text to extract filters
     * Supports syntax like "c:dragon, n:staff" or "c:dragon n:staff"
     *
     * @param {string} text Search string
     * @returns {Object} Object with filters and remaining text
     */
    #parseFilters(text) {
        const filters = {
            component: [], // c:value
            name: [],      // n:value
            general: []    // plain text keywords
        };

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
                    if (value) filters.component.push(value.toLowerCase());
                } else if (trimmed.startsWith('n:')) {
                    const value = trimmed.substring(2).trim();
                    if (value) filters.name.push(value.toLowerCase());
                } else if (trimmed) {
                    // Regular keyword search
                    filters.general.push(trimmed.toLowerCase());
                }
            }
        }

        return filters;
    }

    /**
     * Searches all recipes to find
     *
     * @param {string} text Search string
     *
     * @returns {any[]} results
     */
    searchItems(text) {
        if (!text || !text.trim()) {
            return this._recipes;
        }

        const filters = this.#parseFilters(text);

        return this._recipes.filter(r => {
            // Apply component filters (c:value)
            if (filters.component.length > 0) {
                const componentNames = r.components.map(c => c?.name?.toLowerCase() ?? '').join(' ');
                const matchesComponent = filters.component.every(filter =>
                    componentNames.includes(filter)
                );
                if (!matchesComponent) return false;
            }

            // Apply name filters (n:value)
            if (filters.name.length > 0) {
                const recipeName = r.name.toLowerCase();
                const matchesName = filters.name.every(filter =>
                    recipeName.includes(filter)
                );
                if (!matchesName) return false;
            }

            // Apply general keyword filters (backward compatibility)
            if (filters.general.length > 0) {
                const matchesGeneral = filters.general.every(keyword =>
                    r.searchText.includes(keyword)
                );
                if (!matchesGeneral) return false;
            }

            return true;
        });
    }

    /**
     *
     * @param {*} name The recipe's name
     */
    getRecipeFromName(name) {
        return this._recipes.find((r => (r.name === name)));
    }
}
