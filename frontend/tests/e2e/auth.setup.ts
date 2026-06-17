import { test as setup } from '@playwright/test'

const TEST_USER = {
  email: 'test@culturia.com',
  password: 'TestPassword123!',
}

const TEST_USER_2 = {
  email: 'test2@culturia.com',
  password: 'TestPassword123!',
}

setup('authenticate as test user', async ({ page }) => {
  // Connexion via la VRAIE page de login (/account/login). Les pages de debug /tests/*
  // (dont l'ancien /tests/login) ont été retirées pour raisons de sécurité (#50).
  // Le formulaire réel attend un identifiant (email ou username) + un mot de passe,
  // puis redirige vers l'accueil.
  // NB: sélecteurs basés sur le type d'input (identifiant = texte, mot de passe) ;
  // à confirmer si le composant PixelInput change son rendu.
  await page.goto('/account/login')

  await page.fill('input[type="text"]', TEST_USER.email)
  await page.fill('input[type="password"]', TEST_USER.password)
  await page.click('button[type="submit"]')

  // Connexion réussie → on quitte la page de login (redirection vers l'accueil)
  await page.waitForURL((url) => !url.pathname.startsWith('/account/login'), { timeout: 15000 })

  // Sauvegarde de l'état d'authentification
  await page.context().storageState({ path: 'tests/e2e/.auth/user.json' })
})

export { TEST_USER, TEST_USER_2 }
