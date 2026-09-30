package com.culturiaquests.app;

import android.os.CancellationSignal;

import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/**
 * « Continuer avec Google » natif : ouvre Credential Manager et rend un jeton d'identité Google.
 *
 * Google refuse toute connexion dans une WebView ; or l'app affiche le site distant dans une
 * WebView (Capacitor, `server.url`). Ce greffon passe donc par le système. Il ne fait qu'obtenir
 * le jeton : c'est le serveur (BFF puis Strapi) qui le vérifie et ouvre la session.
 *
 * Choix non-évidents :
 * - Greffon écrit ici plutôt qu'un paquet tiers : une vingtaine de lignes, et aucune dépendance
 *   de plus sur le chemin de l'authentification que les bibliothèques de Google elles-mêmes.
 * - `GetSignInWithGoogleOption` (le bouton « Se connecter avec Google ») plutôt que la connexion
 *   silencieuse : le joueur choisit toujours son compte, rien ne se passe sans son geste.
 * - `serverClientId` est l'ID du client **Web** du projet Google Cloud : c'est l'audience du
 *   jeton que le serveur attend. Les clients Android (un par empreinte de signature) n'apparaissent
 *   nulle part dans le code : Google les reconnaît à la signature de l'APK.
 *
 * Contrat JS : `GoogleSignIn.signIn({ serverClientId })` → `{ idToken }` ; rejet `canceled` si le
 * joueur referme la feuille (à ne pas afficher comme une erreur).
 */
@CapacitorPlugin(name = "GoogleSignIn")
public class GoogleSignInPlugin extends Plugin {

    @PluginMethod
    public void signIn(PluginCall call) {
        String serverClientId = call.getString("serverClientId");
        if (serverClientId == null || serverClientId.isEmpty()) {
            call.reject("serverClientId manquant", "invalid_config");
            return;
        }

        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(serverClientId).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager manager = CredentialManager.create(getContext());

        manager.getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential credential = response.getCredential();
                    if (!(credential instanceof CustomCredential)
                        || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                        call.reject("Identifiant inattendu", "unexpected_credential");
                        return;
                    }
                    try {
                        GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
                        JSObject result = new JSObject();
                        result.put("idToken", google.getIdToken());
                        call.resolve(result);
                    } catch (Exception e) {
                        call.reject("Jeton Google illisible", "unexpected_credential", e);
                    }
                }

                @Override
                public void onError(GetCredentialException e) {
                    if (e instanceof GetCredentialCancellationException) {
                        call.reject("Connexion annulée", "canceled");
                    } else {
                        call.reject(e.getMessage() != null ? e.getMessage() : "Connexion Google impossible", "failed", e);
                    }
                }
            }
        );
    }
}
