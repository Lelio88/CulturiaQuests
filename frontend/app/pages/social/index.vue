<template>
  <div class="min-h-screen bg-gray-100 font-sans pb-24">
    
    <header class="sticky top-0 z-50 p-4 pt-[env(safe-area-inset-top)] bg-gray-100/90 backdrop-blur-sm">
      <div class="bg-white rounded-[30px] shadow-sm p-4 pl-6 flex justify-between items-center">
        
        <h1 class="text-2xl font-bold text-slate-800">Social</h1>

        <div class="flex items-center gap-2">
        <button
          @click="router.push('/social/friends')"
          class="relative w-10 h-10 flex items-center justify-center rounded-full hover:bg-indigo-50 transition-colors cursor-pointer"
        >
          <Icon name="mdi:account-group" class="w-7 h-7 text-indigo-500" />
          <span
            v-if="playerFriendshipStore.hasPendingRequests"
            class="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 border-2 border-white rounded-full animate-pulse"
          />
        </button>

        <button
          v-if="!isQuizDone"
          @click="goToQuiz"
          class="flex items-center gap-3 cursor-pointer group hover:bg-orange-50 px-3 py-1.5 rounded-full transition-all"
        >
          <div class="relative">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-7 h-7 text-orange-500 drop-shadow-sm group-hover:scale-110 transition-transform">
              <path fill="evenodd" d="M19.864 8.465a3.505 3.505 0 0 0-3.03-4.449A3.005 3.005 0 0 0 14 2a2.98 2.98 0 0 0-2 .78A2.98 2.98 0 0 0 10 2c-1.301 0-2.41.831-2.825 2.015a3.505 3.505 0 0 0-3.039 4.45A4.03 4.03 0 0 0 2 12c0 1.075.428 2.086 1.172 2.832A4 4 0 0 0 3 16c0 1.957 1.412 3.59 3.306 3.934A3.52 3.52 0 0 0 9.5 22c.979 0 1.864-.407 2.5-1.059A3.48 3.48 0 0 0 14.5 22a3.51 3.51 0 0 0 3.19-2.06a4.006 4.006 0 0 0 3.138-5.108A4 4 0 0 0 22 12a4.03 4.03 0 0 0-2.136-3.535M9.5 20c-.711 0-1.33-.504-1.47-1.198L7.818 18H7c-1.103 0-2-.897-2-2c0-.352.085-.682.253-.981l.456-.816l-.784-.51A2.02 2.02 0 0 1 4 12c0-.977.723-1.824 1.682-1.972l1.693-.26l-1.059-1.346a1.502 1.502 0 0 1 1.498-2.39L9 6.207V5a1 1 0 0 1 2 0v13.5c0 .827-.673 1.5-1.5 1.5m9.575-6.308l-.784.51l.456.816q.252.452.253.982c0 1.103-.897 2-2.05 2h-.818l-.162.802A1.5 1.5 0 0 1 14.5 20c-.827 0-1.5-.673-1.5-1.5V5c0-.552.448-1 1-1s1 .448 1 1.05v1.207l1.186-.225a1.502 1.502 0 0 1 1.498 2.39l-1.059 1.347l1.693.26A2 2 0 0 1 20 12c0 .683-.346 1.315-.925 1.692"/>
              </svg>
            <span class="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 border-2 border-white rounded-full animate-pulse"></span>
          </div>
          <span class="font-bold text-slate-700 group-hover:text-orange-600 transition">Quiz du jour</span>
        </button>

        <div 
          v-else 
          @click="router.push('/social/quiz')"
          class="flex items-center gap-3 px-3 py-1.5 rounded-full bg-yellow-50/50 cursor-pointer hover:bg-yellow-100 transition-colors"
        >
          <div class="relative">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-7 h-7 text-yellow-500 drop-shadow-sm">
              <path fill="evenodd" d="M19.864 8.465a3.505 3.505 0 0 0-3.03-4.449A3.005 3.005 0 0 0 14 2a2.98 2.98 0 0 0-2 .78A2.98 2.98 0 0 0 10 2c-1.301 0-2.41.831-2.825 2.015a3.505 3.505 0 0 0-3.039 4.45A4.03 4.03 0 0 0 2 12c0 1.075.428 2.086 1.172 2.832A4 4 0 0 0 3 16c0 1.957 1.412 3.59 3.306 3.934A3.52 3.52 0 0 0 9.5 22c.979 0 1.864-.407 2.5-1.059A3.48 3.48 0 0 0 14.5 22a3.51 3.51 0 0 0 3.19-2.06a4.006 4.006 0 0 0 3.138-5.108A4 4 0 0 0 22 12a4.03 4.03 0 0 0-2.136-3.535M9.5 20c-.711 0-1.33-.504-1.47-1.198L7.818 18H7c-1.103 0-2-.897-2-2c0-.352.085-.682.253-.981l.456-.816l-.784-.51A2.02 2.02 0 0 1 4 12c0-.977.723-1.824 1.682-1.972l1.693-.26l-1.059-1.346a1.502 1.502 0 0 1 1.498-2.39L9 6.207V5a1 1 0 0 1 2 0v13.5c0 .827-.673 1.5-1.5 1.5m9.575-6.308l-.784.51l.456.816q.252.452.253.982c0 1.103-.897 2-2.05 2h-.818l-.162.802A1.5 1.5 0 0 1 14.5 20c-.827 0-1.5-.673-1.5-1.5V5c0-.552.448-1 1-1s1 .448 1 1.05v1.207l1.186-.225a1.502 1.502 0 0 1 1.498 2.39l-1.059 1.347l1.693.26A2 2 0 0 1 20 12c0 .683-.346 1.315-.925 1.692"/>
            </svg>
            <div class="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3 text-yellow-600">
                <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>
          <span class="font-bold text-yellow-700">Série : {{ quizStreak }} 🔥</span>
        </div>
        </div>
      </div>
    </header>
    <main class="px-4 space-y-4 pt-2">
        <div v-if="socialStore.loading" class="flex flex-col items-center justify-center py-20">
            <div class="w-10 h-10 border-4 border-[#4D4DFF] border-t-transparent rounded-full animate-spin"></div>
            <p class="mt-4 text-gray-400 font-bold">Chargement des aventures...</p>
        </div>

        <template v-else>
            <PostCard
                v-for="post in socialStore.posts"
                :key="post.id"
                :post="post"
                @refresh="socialStore.fetchPosts"
            />

            <div v-if="socialStore.posts.length === 0" class="text-center py-10 text-gray-400">
                <p>Aucun post pour le moment...</p>
                <p class="text-sm mt-1">Soyez le premier à partager une aventure !</p>
            </div>
        </template>
    </main>

    <div class="fixed bottom-24 right-4 z-40">
        <button 
            @click="router.push('/createpost')"
            class="w-14 h-14 bg-[#4D4DFF] rounded-full flex items-center justify-center text-white shadow-lg hover:bg-[#3d3ddb] transition-transform hover:scale-105 active:scale-95 group"
        >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 transition-transform group-hover:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
        </button>
    </div>

  </div>
</template>

<script setup>
import { onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import PostCard from '~/components/social/PostCard.vue';
import { useSocialStore } from '~/stores/social';
import { usePlayerFriendshipStore } from '~/stores/playerFriendship';
import { useQuizStore } from '~/stores/quiz';
import { useGuildStore } from '~/stores/guild';

const router = useRouter();
const socialStore = useSocialStore();
const playerFriendshipStore = usePlayerFriendshipStore();
const quizStore = useQuizStore();
const guildStore = useGuildStore();

// --- ÉTAT DU QUIZ ---
const isQuizDone = computed(() => quizStore.alreadyCompleted);
const quizStreak = computed(() => guildStore.quizStreak);

// --- RÉCUPÉRATION DES POSTS (centralisée dans le store social, #36) ---
onMounted(() => {
    socialStore.fetchPosts();
    playerFriendshipStore.fetchFriendships();
    quizStore.fetchTodayQuiz();
    guildStore.refetchStats();
});

const goToQuiz = () => {
    router.push('/social/quiz');
};
</script>

<style scoped>
.shadow-sm {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
</style>