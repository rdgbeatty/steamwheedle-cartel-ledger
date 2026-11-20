# ADR 02 — Collect Blizzard's Forever US PvP auction feeds

## Owner decision

Support **World of Warcraft: Forever** exclusively and lock collection to **US PvP**. Cover all items across Alliance, Horde and neutral. The owner confirmed that house **116** was the intended neutral market by matching individual Stranglekelp orders in game.

## AI decision

Read Blizzard's item and commodity feeds for fixed house IDs **110**, **113** and **116**, using community mappings for the faction houses. The ruleset URL can return the same list across rulesets. Preserve variants and keep auctioned IDs visible when their catalog data is missing. [Feed notes](https://blizzard.pinta.land/forever/auctions/), [market comparison](https://hyjal.cc/auctions/us/pvp/alliance/item/3820/stranglekelp), [neutral diagnostic](../README.md#local-operation)
