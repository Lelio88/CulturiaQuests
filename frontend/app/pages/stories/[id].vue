<template>
    <UiOverlayPanel @close="goBack">
        
        <div v-if="loading" class="text-center py-20 text-gray-500 font-pixel">
            Chargement du journal...
        </div>

        <div v-else-if="error" class="text-center py-20 text-red-500 font-bold">
            {{ error }}
        </div>

        <StoriesJournalDetail v-else-if="details" :details="details" />

    </UiOverlayPanel>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router';
import { onMounted, ref } from 'vue';
import { useFriendshipStore } from '~/stores/friendship';
import { useNpcStore } from '~/stores/npc';

// #47.2 / #36 : la page ne fait plus d'appel API direct. La friendship est lue dans le store
// friendship (déjà normalisé) ; les dialogues du PNJ — non peuplés par le store (populate ['npc']
// seulement) — sont récupérés par un fetch CIBLÉ d'un seul PNJ via npcStore.fetchNpcByDocumentId.

const route = useRoute();
const router = useRouter();
const friendshipStore = useFriendshipStore();
const npcStore = useNpcStore();
const { formatNpcName, npcImagePath } = useNpcPresentation();
const friendshipId = route.params.id;

const details = ref(null);
const loading = ref(true);
const error = ref(null);

const goBack = () => {
    router.push('/stories');
};

onMounted(async () => {
    try {
        const idToSearch = Number(friendshipId);

        // 1. Charger les friendships si nécessaire, puis retrouver celle demandée
        if (!friendshipStore.hasFriendships) {
            await friendshipStore.fetchFriendships();
        }

        const friendship = friendshipStore.friendships.find(f => f.id === idToSearch);
        if (!friendship) {
            error.value = "Journal introuvable";
            return;
        }

        const currentLevel = (friendship.quests_entry_unlocked || 0) + (friendship.expedition_entry_unlocked || 0);

        // 2. Récupérer le PNJ AVEC ses dialogues (fetch ciblé d'un seul PNJ)
        const npc = friendship.npcDocumentId
            ? await npcStore.fetchNpcByDocumentId(friendship.npcDocumentId, true)
            : null;

        const maxLevel = (npc?.quests_entry_available || 0) + (npc?.expedition_entry_available || 0) || 4;

        // 3. Traitement des dialogues : uniquement le type "journal_entries"
        const rawDialogs = npc?.dialogs?.data || npc?.dialogs || [];
        const journalDialogs = rawDialogs.filter((dObj) => {
            const d = dObj.attributes || dObj;
            return d.text_type === 'journal_entries';
        });

        const entries = [];
        journalDialogs.forEach((dObj) => {
            const d = dObj.attributes || dObj;
            const texts = d.dialogues || [];

            texts.forEach((text, index) => {
                const entryNumber = index + 1;
                if (entryNumber <= currentLevel) {
                    entries.push({
                        id: `${d.id}-${index}`,
                        index: entryNumber,
                        text: text
                    });
                }
            });
        });

        entries.sort((a, b) => b.index - a.index);

        details.value = {
            fullName: formatNpcName(npc?.firstname, npc?.lastname),
            job: npc?.nickname,
            image: npcImagePath(npc?.firstname),
            level: currentLevel,
            maxLevel: maxLevel,
            entries: entries
        };

    } catch (e) {
        console.error("Erreur chargement journal:", e);
        error.value = "Impossible de charger le journal.";
    } finally {
        loading.value = false;
    }
});

definePageMeta({
    pageTransition: {
        name: 'slide-up',
        mode: 'out-in'
    }
});
</script>