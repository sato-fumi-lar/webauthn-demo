const express   = require('express');
const utils     = require('../utils');
const config    = require('../config.json');
const base64url = require('base64url');
const router    = express.Router();
const database  = require('./db');
const dbutils = require('./dbutils');

router.post('/register', (request, response) => {
    if(!request.body || !request.body.username || !request.body.name) {
        response.json({
            'status': 'failed',
            'message': 'Request missing name or username field!'
        })

        return
    }

    let username = request.body.username;
    let name     = request.body.name;

    if(database[username] && database[username].registered) {
        response.json({
            'status': 'failed',
            'message': `Username ${username} already exists`
        })

        return
    }

    if(!database[username]){
        database[username] = {
            'name': name,
            'registered': false,
            'id': utils.randomBase64URLBuffer(),
            'authenticators': []    
        };
    } else {
        database[username].registered = false;
        database[username].authenticators = [];
    }


    let challengeMakeCred    = utils.generateServerMakeCredRequest(username, name, database[username].id)
    challengeMakeCred.status = 'ok'

    request.session.challenge = challengeMakeCred.challenge;
    request.session.username  = username;

    response.json(challengeMakeCred)
})

router.post('/login', (request, response) => {
    if(request.body && request.body.loginWithResidentKey){
        let getAssertion    = utils.generateServerGetAssertion()
        getAssertion.status = 'ok';
        request.session.challenge = getAssertion.challenge;
        response.json(getAssertion)
        return;
    }
    if(!request.body || !request.body.username) {

        response.json({
            'status': 'failed',
            'message': 'Request missing username field!'
        })
        return
    }

    let username = request.body.username;

    if(!database[username]) {
         response.json({
            'status': 'failed',
            'message': `User ${username} does not exist!`
        })

    }

    if(!database[username].registered) {
        response.json({
            'status': 'failed',
            'message': `User ${username} does not registered!`
        })

        return
    }


    let getAssertion    = utils.generateServerGetAssertion(database[username].authenticators)
    getAssertion.status = 'ok'

    request.session.challenge = getAssertion.challenge;
    request.session.username  = username;

    response.json(getAssertion)
})

router.post('/response', (request, response) => {
    if(!request.body       || !request.body.id
    || !request.body.rawId || !request.body.response
    || !request.body.type  || request.body.type !== 'public-key' ) {
        response.json({
            'status': 'failed',
            'message': 'Response missing one or more of id/rawId/response/type fields, or type is not public-key!'
        })

        return
    }

    let webauthnResp = request.body
    let clientData   = JSON.parse(base64url.decode(webauthnResp.response.clientDataJSON));

    /* Check challenge... */
    if(clientData.challenge !== request.session.challenge) {
        response.json({
            'status': 'failed',
            'message': 'Challenges don\'t match!'
        })
    }

    /* ...and origin */
    if(clientData.origin !== config.origin) {
        response.json({
            'status': 'failed',
            'message': 'Origins don\'t match!'
        })
    }

    let result;
    if(webauthnResp.response.attestationObject !== undefined) {
        /* This is create cred */
        result = utils.verifyAuthenticatorAttestationResponse(webauthnResp);

        if(result.verified) {
            database[request.session.username].authenticators.push(result.authrInfo);
            database[request.session.username].registered = true
        }
    } else if(webauthnResp.response.authenticatorData !== undefined) {
        /* This is get assertion */
        var username = request.session.username;
        if(!request.session.username){
            var credentialId = webauthnResp.rawId;
            username = dbutils.getUsernameFromCredentialID(credentialId);
            request.session.username = username;
        }
        result = utils.verifyAuthenticatorAssertionResponse(webauthnResp, database[request.session.username].authenticators);
    } else {
        response.json({
            'status': 'failed',
            'message': 'Can not determine type of response!'
        })
    }

    if(result.verified) {
        request.session.loggedIn = true;
        response.json({ 'status': 'ok' })
    } else {
        response.json({
            'status': 'failed',
            'message': 'Can not authenticate signature!'
        })
    }
})

module.exports = router;
