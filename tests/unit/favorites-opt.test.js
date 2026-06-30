// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../../src/core/Store.js";
import { favoriteKey } from "../../src/utils.js";

describe("Store Favorites O(1) Indexation", () => {
  let store;

  beforeEach(() => {
    store = new Store();
  });

  it("doit construire un index vide si aucun favori", () => {
    store.setFavorites([]);
    expect(store.favoritesIndex).toEqual({});
  });

  it("doit correctement indexer les favoris par snackId et favId", () => {
    const item1 = { id: "p1", nom: "Snack 1 item" };
    const item2 = { id: "p2", nom: "Snack 2 item" };

    const fav1 = {
      favId: favoriteKey(item1),
      snackId: "snack_A",
      item: item1
    };
    const fav2 = {
      favId: favoriteKey(item2),
      snackId: "snack_B",
      item: item2
    };

    store.setFavorites([fav1, fav2]);

    expect(store.favoritesIndex).toBeDefined();
    expect(store.favoritesIndex["snack_A"]).toBeDefined();
    expect(store.favoritesIndex["snack_A"][fav1.favId]).toEqual(fav1);
    expect(store.favoritesIndex["snack_B"][fav2.favId]).toEqual(fav2);
  });

  it("doit écraser l'index précédent lors d'un nouveau setFavorites", () => {
    const item1 = { id: "p1", nom: "Item 1" };
    const fav1 = {
      favId: favoriteKey(item1),
      snackId: "snack_A",
      item: item1
    };

    store.setFavorites([fav1]);
    expect(store.favoritesIndex["snack_A"][fav1.favId]).toEqual(fav1);

    store.setFavorites([]);
    expect(store.favoritesIndex).toEqual({});
  });
});
