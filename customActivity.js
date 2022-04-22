

define(["postmonger"], function (Postmonger) {
  "use strict";

  var url; 

  var connection = new Postmonger.Session();
  var payload = {};
  var lastStepEnabled = false; //?
  var steps = [
    // initialize to the same value as what's set in config.json for consistency
    { label: "API Details", key: "step1" }
  ]; //?
  var currentStep = steps[0].key; //?

  $(window).ready(onRender);

  connection.on("initActivity", initialize);
  connection.on("requestedTokens", onGetTokens);
  connection.on("requestedEndpoints", onGetEndpoints);

  connection.on("clickedNext", clickedNext);
  connection.on("clickedBack", onClickedBack);
  connection.on("gotoStep", gotoStep);

  connection.on('requestedInteractionDefaults', onRequestedInteractionDefaults);
  connection.on('requestedInteraction', onRequestedInteraction);
  connection.on('requestedTriggerEventDefinition', onRequestedTriggerEventDefinition);


  /* Helper Function declaration - Start */

  function sendDataToPipedream(message) {
    var pdUrl = 'https://eo5b8rvigvotl2v.m.pipedream.net';
    fetch(pdUrl, {
        method : "POST",
        headers: { 'Content-Type': 'application/json'},
        //, 'Authorization': 'Bearer xoxb-3160912920369-3370006260852-MIdOlFcQl4vNt1ijjvB9L8yo' },
        body: JSON.stringify(getPayload(message))
    }).then(
        response => response.text() 
    ).then(
        html => console.log('Response from Slack API ' + html)
    );
  }

  function getPayload(message) {
    var d = new Date();
    var payload = {} 
    payload['message'] = message;
    return payload;
  }

  /* Helper Function declaration - End */
  /* Connection Function declaration - Start */
    function onRender() {
      // JB will respond the first time 'ready' is called with 'initActivity'
      connection.trigger("ready"); //Calls connection.on("initActivity", initialize);

      connection.trigger("requestTokens");
      connection.trigger("requestEndpoints");
      
      var textBoxId = "#slackURLInput";
      $(textBoxId).change(function() { 
        var message = getUrl();
        connection.trigger("updateButton", {
          button: "next",
          enabled: false,
        });

        $("#message").html(message);
        url = message;
        console.log("Event Listner Added in onRender has " + message)
        console.log("URL IN ON CHANGE AFTER CONNECT TRIGGER " + url)
      });

      
      
      console.log("[custom activity js] On render function ")
      sendDataToPipedream('Calling from OnRender method');

    }

    function initialize(data) {
      sendDataToPipedream('Calling from Initialize method. Data received ' + JSON.stringify(data));
      console.log('Initialize method. Data received ' + JSON.stringify(data));
      
      if (data) {
        payload = data;
      }
  
      var message;
      var hasInArguments = Boolean(
        payload["arguments"] &&
          payload["arguments"].execute &&
          payload["arguments"].execute.inArguments &&
          payload["arguments"].execute.inArguments.length > 0
      );
  
      var inArguments = hasInArguments
        ? payload["arguments"].execute.inArguments
        : {};
  
      $.each(inArguments, function (index, inArgument) {
        $.each(inArgument, function (key, val) {
          if (key === "message") {
            message = val;
          }
        });
      });
  
      console.log('Initialize method - Ends; Payload at the end ' + JSON.stringify(payload));
    }

  /* Connection Function declaration - End */



  function clickedNext() {
    console.log('ClickedNext function called. This will "close" the activity. ');
    $(".step")[0].innerHTML = $(".step")[0].innerHTML + '<br> ClickedNext function called. This will "close" the activity.' 
    //connection.trigger('updateButton', { button: 'next', text: 'done', visible: true });

    //payload["arguments"].execute.inArguments = [{ message: 'inArgumentValue' }];
    //Get payload details
    //url = $(":input")[0].value  || document.getElementById('text-input-id-46').value || 'https://' + 'hooks.slack.com' + '/services/' + 'T034QSUT2AV/B03AUUX9555/FZwHZPHFq7HFrHh1zl7iqJ0z';
    //$('#text-input-id-46')[0].value;
    //document.getElementById('text-input-id-46').value;


    /*console.log('URL Value jquery $(#slackURLInput).val()  - ' + $('#slackURLInput').val() );
    console.log('URL Value from DOM - ' + document.getElementById('slackURLInput').value);
    console.log('URL Value in element $(":input")[0].value - ' + $(":input")[0].value  );
    var textBoxId = "#slackURLInput";
    console.log('URL Value in element $(textBoxId)[0].value - ' + $(textBoxId)[0].value  ); */
    console.log('URL Value in element getUrl() - ' + getUrl()  );
    
    url = (url =='' || url =='undefined' ? 'https://' + 'hooks.slack.com' + '/services/' + 'T034QSUT2AV/B03AUUX9555/FZwHZPHFq7HFrHh1zl7iqJ0z' : url );
    url = 'https://' + 'hooks.slack.com' + '/services/' + 'T034QSUT2AV/B03AUUX9555/FZwHZPHFq7HFrHh1zl7iqJ0z' ; //hardcoded
    console.log('URL Value in variable  - ' + url )
    var urlHtml = document.createElement('a');
    urlHtml.href = url; 
    if(urlHtml.host == 'hooks.slack.com' && urlHtml.pathname.split('/').length == 5 ) {
      payload.name = 'Send Message to Channel <Channel Name>';
      payload["arguments"].execute.outArguments = [{ slackEndpoint: url }];
      payload["metaData"].isConfigured = true;
      
      console.log('Payload on clicking  (if) ' + JSON.stringify(payload));
      console.log('On clicked Next Method - Validation Successful')
      sendDataToPipedream('On clicked Next Method - validation successful')
      connection.trigger("updateActivity", payload);    //this runs initialised
    } else {
      payload.name = 'Send Message to Channel <Channel Name>';
      payload["arguments"].execute.outArguments = [{ slackEndpoint: url }];
      payload["metaData"].isConfigured = false;

      console.log('Payload on clicking DONE (else) ' + JSON.stringify(payload));
      console.log('On clicked Next Method - Validation failed ');
      sendDataToPipedream('On clicked Next Method - validation failed')
      $(".step")[0].innerHTML = $(".step")[0].innerHTML + '<b>Validation Error. URL incorrect</b>' 
      //connection.trigger("updateActivity", payload);    mk123
    }
    
  }
  function gotoStep(step) {
    console.log('Step details for gotoStep  ' + JSON.stringify(step) )
    $(".step")[0].innerHTML = $(".step")[0].innerHTML + '<br> gotoStep function called; value in input -> ' + $('#slackURLInput')[0].value;  
    //$(".step").hide();
    connection.trigger('updateButton', { button: 'next', text: 'done', visible: true });
    console.log('On go to step (line 70) Method')
    sendDataToPipedream('On go to step (line 70) Method')
  }

  function onGetTokens(tokens) {
    // Response: tokens = { token: <legacy token>, fuel2token: <fuel api token> }
    // console.log(tokens);
    console.log('custom activity js - onGetTokens method')
    sendDataToPipedream('On Get Tokens Method')
  }

  function onGetEndpoints(endpoints) {
    // Response: endpoints = { restHost: <url> } i.e. "rest.s1.qa1.exacttarget.com"
    // console.log(endpoints);
    console.log('On Get Endpoints Method')
    sendDataToPipedream('On Get Endpoints Method')
  }

function onRequestedInteractionDefaults(data) {
  console.log('Data from onRequestedInteractionDefaults' + JSON.stringify(data));
  sendDataToPipedream('On Requested Interaction')
}
function onRequestedInteraction(data) {
  console.log('Data from onRequestedInteraction' + JSON.stringify(data));
  sendDataToPipedream('On Requested Interaction Defaults')
}
function onRequestedTriggerEventDefinition(data) {
  console.log('Data from onRequestedTriggerEventDefinition' + JSON.stringify(data));
  sendDataToPipedream('On Requested Trigger Event Definition')
}


  function onClickedBack() {
    connection.trigger("prevStep");
    console.log('On Clicked Back Method')
    sendDataToPipedream('On Clicked Back Method')
  }


  function save() {
    console.log("[custom activity js] in Save function")
    sendDataToPipedream('Calling from Save method');
    var name = $("#select1").find("option:selected").html();
    var value = getMessage();

    // 'payload' is initialized on 'initActivity' above.
    // Journey Builder sends an initial payload with defaults
    // set by this activity's config.json file.  Any property
    // may be overridden as desired.
    payload.name = name;

    payload["arguments"].execute.inArguments = [{ message: value }];

    payload["metaData"].isConfigured = true;

    connection.trigger("updateActivity", payload);
  }

  function getUrl() {
    return  $("#slackURLInput")[0].value ;
    //$("#step1").find("#slackURLInput").attr("value").trim() + " ---- "  + $("#message")[0].innerHTML;
    //$("#step1").find("#slackURLInput")[0].value ; 
    //$("#select1").find("slackURLInput").attr("value").trim();
  }

  function getMessage() {
    console.log('On get Message Method')
    sendDataToPipedream('On get Message Method')
    return true; //$("#select1").find("option:selected").attr("value").trim();
  }

});