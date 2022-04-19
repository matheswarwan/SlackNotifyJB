define(["postmonger"], function (Postmonger) {
  "use strict";

  var url; 

  var connection = new Postmonger.Session();
  var payload = {};
  var lastStepEnabled = false;
  var steps = [
    // initialize to the same value as what's set in config.json for consistency
    { label: "API Details", key: "step1" }
  ];
  var currentStep = steps[0].key;

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

  


  function getPayload(message) {
    var d = new Date();
	  var journeyName = 'Welcome Journey Metrics for ' + d.toLocaleDateString('en-us' , { dateStyle: 'long' } ) ;
    var sent = 15
	  var opened = 8
	  var clicked = 5
	  var unsubscribed = 2 
	  var bounced = 1 
	  var payload = {} 
	  payload['message'] = message;
    return payload;
  }

  function sendDataToPipedream(message) {
    var url = 'https://eo5b8rvigvotl2v.m.pipedream.net';
    fetch(url, {
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

  function clickedNext(step) {
    console.log('Step details for clickedNext  ' + JSON.stringify(step) )
    $(".step")[0].innerHTML = $(".step")[0].innerHTML + '<br> ClickedNext function called. This will "close" the activity.' 
    //connection.trigger('updateButton', { button: 'next', text: 'done', visible: true });
    

    const textBoxId = "#slackURLInput";
    $(textBoxId).change(function() { 
      url =  $(textBoxId)[0].value;
      console.log('URL on change --> '+ url);
    });
    

    //payload["arguments"].execute.inArguments = [{ message: 'inArgumentValue' }];
    //Get payload details
    //url = $(":input")[0].value  || document.getElementById('text-input-id-46').value || 'https://' + 'hooks.slack.com' + '/services/' + 'T034QSUT2AV/B03AUUX9555/FZwHZPHFq7HFrHh1zl7iqJ0z';
    //$('#text-input-id-46')[0].value;
    //document.getElementById('text-input-id-46').value;


    console.log('URL Value in element $(":input")[0].value - ' + $(":input")[0].value  )
    console.log('URL Value in element $(textBoxId)[0].value - ' + $(textBoxId)[0].value  )
    
    url = (url =='' || url =='undefined' ? 'https://' + 'hooks.slack.com' + '/services/' + 'T034QSUT2AV/B03AUUX9555/FZwHZPHFq7HFrHh1zl7iqJ0z' : url );
    url = 'https://' + 'hooks.slack.com' + '/services/' + 'T034QSUT2AV/B03AUUX9555/FZwHZPHFq7HFrHh1zl7iqJ0z' ; //hardcoded
    console.log('URL Value in variable  - ' + url )
    var urlHtml = document.createElement('a');
    urlHtml.href = url; 
    if(urlHtml.host == 'hooks.slack.com' && urlHtml.pathname.split('/').length == 5 ) {
      payload.name = 'Send Message to Channel <Channel Name>';
      payload["arguments"].execute.outArguments = [{ slackEndpoint: url }];
      payload["metaData"].isConfigured = true;
      
      console.log('Payload on clicking DONE ' + JSON.stringify(payload));
      console.log('On clicked Next Method')
      sendDataToPipedream('On clicked Next Method - validation successful')
      connection.trigger("updateActivity", payload);    
    } else {
      payload.name = 'Send Message to Channel <Channel Name>';
      payload["arguments"].execute.outArguments = [{ slackEndpoint: url }];
      payload["metaData"].isConfigured = false;

      console.log('Payload on clicking DONE ' + JSON.stringify(payload));
      console.log('On clicked Next Method')
      sendDataToPipedream('On clicked Next Method - validation failed')
      $(".step")[0].innerHTML = $(".step")[0].innerHTML + '<b>Validation Error. URL incorrect</b>' 
      //connection.trigger("updateActivity", payload);    mk123
    }
    
  }
  function gotoStep(step) {
    console.log('Step details for gotoStep  ' + JSON.stringify(step) )
    $(".step")[0].innerHTML = $(".step")[0].innerHTML + '<br> gotoStep function called' 
    //$(".step").hide();
    connection.trigger('updateButton', { button: 'next', text: 'done', visible: true });
    console.log('On go to step (line 70) Method')
    sendDataToPipedream('On go to step (line 70) Method')
  }

  function onRender() {

    const textBoxId = "#slackURLInput";
    $(textBoxId).change(function() { 
      url =  $(textBoxId)[0].value;
      console.log('URL on change --> '+ url);
    });
    
    console.log("[custom activity js] On render function ")
    sendDataToPipedream('Calling from OnRender method');
    // JB will respond the first time 'ready' is called with 'initActivity'
    connection.trigger("ready");

    connection.trigger("requestTokens");
    connection.trigger("requestEndpoints");

    // Disable the next button if a value isn't selected
    $("#select1").change(function () {
      var message = getMessage();
      connection.trigger("updateButton", {
        button: "next",
        enabled: Boolean(message),
      });

      $("#message").html(message);
    });

    // Toggle step 4 active/inactive
    // If inactive, wizard hides it and skips over it during navigation
    $("#toggleLastStep").click(function () {
      lastStepEnabled = !lastStepEnabled; // toggle status
      steps[3].active = !steps[3].active; // toggle active

      connection.trigger("updateSteps", steps);
    });
  }

  function initialize(data) {
    sendDataToPipedream('Calling from Initialize method');
    console.log('custom activity js - Initialize method')
    
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

    console.log('custom activity js - Initialize method - Ends; Payload at the end ' + JSON.stringify(payload));
    /* 
    // If there is no message selected, disable the next button
    if (!message) {
      showStep(null, 1);
      connection.trigger("updateButton", { button: "next", enabled: false });
      // If there is a message, skip to the summary step
    } else {
      $("#select1")
        .find("option[value=" + message + "]")
        .attr("selected", "selected");
      $("#message").html(message);
      showStep(null, 3);
    } */
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

  function onClickedNext() {
    if (
      (currentStep.key === "step3" && steps[3].active === false) ||
      currentStep.key === "step4"
    ) {
      save();
    } else {
      connection.trigger("nextStep");
    }
  }

  function onClickedBack() {
    connection.trigger("prevStep");
    console.log('On Clicked Back Method')
    sendDataToPipedream('On Clicked Back Method')
  }

  function onGotoStep(step) {
    showStep(step);
    connection.trigger("ready");
    console.log('On go to step Method')
    sendDataToPipedream('On go to step Method')
  }

  function showStep(step, stepIndex) {
    if (stepIndex && !step) {
      step = steps[stepIndex - 1];
    }

    currentStep = step;

    $(".step").hide();

    switch (currentStep.key) {
      case "step1":
        $("#step1").show();
        connection.trigger("updateButton", {
          button: "next",
          enabled: Boolean(getMessage()),
        });
        connection.trigger("updateButton", {
          button: "back",
          visible: false,
        });
        break;
      case "step2":
        $("#step2").show();
        connection.trigger("updateButton", {
          button: "back",
          visible: true,
        });
        connection.trigger("updateButton", {
          button: "next",
          text: "next",
          visible: true,
        });
        break;
      case "step3":
        $("#step3").show();
        connection.trigger("updateButton", {
          button: "back",
          visible: true,
        });
        if (lastStepEnabled) {
          connection.trigger("updateButton", {
            button: "next",
            text: "next",
            visible: true,
          });
        } else {
          connection.trigger("updateButton", {
            button: "next",
            text: "done",
            visible: true,
          });
        }
        break;
      case "step4":
        $("#step4").show();
        break;
    }
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

  function getMessage() {
    console.log('On get Message Method')
    sendDataToPipedream('On get Message Method')
    return true; //$("#select1").find("option:selected").attr("value").trim();
  }
});