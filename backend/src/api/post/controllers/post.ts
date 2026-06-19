/**
 * post controller
 */

import { factories } from '@strapi/strapi'
import { getUserGuild } from '../../../utils/guild-helpers'

export default factories.createCoreController('api::post.post', ({ strapi }) => ({
  async create(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return ctx.unauthorized('You must be logged in to create a post');
    }

    const { body } = ctx.request;
    const data = body.data || {};

    const authorId = user.documentId || user.id;

    // Anti mass-assignment : whitelist des champs. `likes` n'est JAMAIS accepté du client
    // (sinon pré-remplissage de likes) et `author` est forcé sur l'utilisateur courant.
    const postData: any = {
        show_loot: typeof data.show_loot === 'boolean' ? data.show_loot : true,
        tags: data.tags ?? null,
        author: authorId,
    };

    // Ownership des relations affichées : un joueur ne peut publier que SON run et SON
    // loot, pas ceux d'autrui (les relations sont validées contre sa guilde).
    const myGuild = await getUserGuild(strapi, user.id, {
        select: ['id'],
    });

    const runDocId = typeof data.run_history === 'string' ? data.run_history : data.run_history?.documentId;
    if (runDocId) {
        const ownedRun = await strapi.db.query('api::run.run').findOne({
            where: { documentId: runDocId, guild: { id: myGuild?.id } },
            select: ['documentId'],
        });
        if (!ownedRun) return ctx.badRequest('run_history invalide ou non possédé');
        postData.run_history = runDocId;
    }

    const lootDocId = typeof data.best_loot === 'string' ? data.best_loot : data.best_loot?.documentId;
    if (lootDocId) {
        const ownedItem = await strapi.db.query('api::item.item').findOne({
            where: { documentId: lootDocId, guild: { id: myGuild?.id } },
            select: ['documentId'],
        });
        if (!ownedItem) return ctx.badRequest('best_loot invalide ou non possédé');
        postData.best_loot = lootDocId;
    }

    const post = await strapi.documents('api::post.post').create({
        data: postData
    });
    
    const sanitized = await this.sanitizeOutput(post, ctx);
    return this.transformResponse(sanitized);
  },

  async find(ctx) {
    const user = ctx.state.user;

    // Configuration de base pour la population
    const populate: any = [
        'author',
        'author.avatar',
        'run_history',
        'run_history.museum',
        'run_history.museum.tags',
        'likes',
        'best_loot',
        'best_loot.rarity',
        'best_loot.icon'
    ];

    if (!user) {
        return this.transformResponse([]);
    }

    // 1. Récupérer la guilde de l'utilisateur courant
    const myGuild: any = await getUserGuild(strapi, user.id, {
        select: ['documentId'],
    });

    // Initialiser la liste avec soi-même
    const friendUserDocIds: string[] = user.documentId ? [user.documentId] : [];
    const friendUserNumericIds: number[] = [user.id];

    if (myGuild) {
        // 2. Trouver toutes les amitiés acceptées impliquant la guilde courante
        const acceptedFriendships: any[] = await strapi.db.query('api::player-friendship.player-friendship').findMany({
            where: {
                status: 'accepted',
                $or: [
                    { requester: { documentId: myGuild.documentId } },
                    { receiver: { documentId: myGuild.documentId } },
                ],
            },
            populate: {
                requester: {
                    select: ['documentId'],
                    populate: { user: { select: ['id', 'documentId'] } },
                },
                receiver: {
                    select: ['documentId'],
                    populate: { user: { select: ['id', 'documentId'] } },
                },
            },
        });

        // 3. Extraire les IDs utilisateur des guildes amies
        for (const friendship of acceptedFriendships) {
            const friendGuild = friendship.requester?.documentId === myGuild.documentId
                ? friendship.receiver
                : friendship.requester;

            const friendUser = friendGuild?.user;
            if (friendUser?.documentId) friendUserDocIds.push(friendUser.documentId);
            if (friendUser?.id) friendUserNumericIds.push(friendUser.id);
        }
    }

    // 4. Récupérer les posts du cercle social (Soi-même + Amis)
    const allPosts = await strapi.documents('api::post.post').findMany({
        filters: {
            author: {
                $or: [
                    { documentId: { $in: friendUserDocIds } },
                    { id: { $in: friendUserNumericIds } }
                ]
            }
        },
        sort: 'createdAt:desc',
        limit: 50,
        populate
    }) as any[];

    // 3. Enrichissement (Likes & Protection Auteur)
    const sanitized = await this.sanitizeOutput(allPosts, ctx) as any[];
    
    const enriched = sanitized.map((post, index) => {
        const rawPost = allPosts[index];
        const likes = rawPost.likes || [];
        const isLiked = likes.some(u => (u.documentId === user.documentId) || (u.id === user.id));
        
        // Strapi 5 sanitize peut parfois vider les relations sensibles, on ré-injecte l'auteur si besoin
        const authorData = post.author || rawPost.author || {};
        
        return {
            ...post,
            author: authorData,
            likes: likes.length,
            hasLiked: isLiked
        };
    });

    return this.transformResponse(enriched);
  },

  async toggleLike(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();
      
      const { id } = ctx.params;
      
      const post = await strapi.documents('api::post.post').findOne({
          documentId: id,
          populate: ['likes']
      });
      
      if (!post) return ctx.notFound();
      
      const likes = post.likes || [];
      const isLiked = likes.some(u => (u.documentId === user.documentId) || (u.id === user.id));
      
      let newLikes;
      const currentLikeIds = likes.map(u => u.documentId || u.id);
      const userKey = user.documentId || user.id;

      if (isLiked) {
          newLikes = currentLikeIds.filter(uid => uid !== userKey);
      } else {
          newLikes = [...currentLikeIds, userKey];
      }
      
      await strapi.documents('api::post.post').update({
          documentId: id,
          data: {
              likes: newLikes
          }
      });
      
      return {
          ok: true,
          liked: !isLiked,
          likes: newLikes.length
      };
  }
}));
